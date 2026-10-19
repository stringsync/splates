import { Dispatcher } from "webappwiz/events";
import { type Lock, MemoryLock } from "webappwiz/system";
import type { Collection } from "./collection";
import type { Document, DocumentOptions } from "./document";
import { documentText, entriesOf, logLines } from "./json";
import { checkName, keyIn } from "./key";
import type { Log, LogOptions, Segment } from "./log";
import type { Storage, StorageChanges, Watch, WatchOptions } from "./storage";

/**
 * Storage held in this process alone, for tests that need no disk, and to
 * keep the primitives from leaning on anything only files do. Every view
 * `within` makes shares what the one it came from holds.
 */
export class MemoryStorage implements Storage {
	constructor(
		readonly root = "",
		private readonly held: Held = {
			values: new Map(),
			locks: new Map(),
			watches: new Set(),
		},
	) {}

	/** What is kept under `key`, as text or bytes, for a test to check. */
	peek(key: string): string | Uint8Array | undefined {
		return this.held.values.get(this.full(key));
	}

	document<T>(key: string, opts: DocumentOptions<T> = {}): Document<T> {
		const at = this.full(key);
		const lock = this.lock(opts.lock ?? `${key}.lock`);
		const read = async (): Promise<T | null> => {
			const raw = this.text(at);
			if (raw === null) {
				return null;
			}
			const value: unknown = JSON.parse(raw);
			return opts.schema === undefined
				? (value as T)
				: opts.schema.parse(value);
		};
		const write = async (value: T): Promise<void> =>
			this.set(at, documentText(value));
		return {
			key,
			read,
			write,
			update: async (edit) => {
				await lock.acquire();
				try {
					const value = await edit(await read());
					await write(value);
					return value;
				} finally {
					await lock.release();
				}
			},
			remove: async () => this.delete(at),
		};
	}

	log<T>(key: string, opts: LogOptions<T> = {}): Log<T> {
		const at = this.full(key);
		const segmentsAt = this.full(opts.segments ?? `${key}.segments`);
		const segmentAt = (segment: Segment) => `${segmentsAt}/${segment.name}`;
		const segments = async (): Promise<Segment[]> =>
			this.under(segmentsAt)
				.sort()
				.map((name) => ({ name, at: Number.parseInt(name, 10) }));
		return {
			key,
			append: async (...entries) => {
				if (entries.length > 0) {
					this.set(at, (this.text(at) ?? "") + logLines(entries));
				}
			},
			replay: async () => entriesOf(this.text(at) ?? "", opts.schema),
			rotate: async () => {
				const raw = this.text(at);
				if (raw === null) {
					return null;
				}
				const now = Date.now();
				const segment = {
					name: `${now}-${crypto.randomUUID()}.jsonl`,
					at: now,
				};
				this.delete(at);
				this.set(segmentAt(segment), raw);
				return segment;
			},
			segments,
			replaySegment: async (segment) =>
				entriesOf(this.text(segmentAt(segment)) ?? "", opts.schema),
			dropSegment: async (segment) => this.delete(segmentAt(segment)),
			remove: async () => {
				this.delete(at);
				for (const segment of await segments()) {
					this.delete(segmentAt(segment));
				}
			},
		};
	}

	collection(key: string): Collection {
		const dir = this.full(key);
		const at = (name: string) => `${dir}/${checkName(name)}`;
		const value = (name: string) => this.held.values.get(at(name));
		return {
			key,
			read: async (name) => {
				const held = value(name);
				return typeof held === "string" ? held : null;
			},
			write: async (name, text) => this.set(at(name), text),
			readBytes: async (name) => {
				const held = value(name);
				return held === undefined
					? null
					: typeof held === "string"
						? new TextEncoder().encode(held)
						: held;
			},
			writeBytes: async (name, bytes) => this.set(at(name), bytes.slice()),
			list: async () => this.under(dir).sort(),
			remove: async (name) => this.delete(at(name)),
			clear: async () => {
				for (const name of this.under(dir)) {
					this.delete(at(name));
				}
			},
			size: async () =>
				this.under(dir).reduce((sum, name) => {
					const held = value(name);
					return (
						sum +
						(typeof held === "string"
							? new TextEncoder().encode(held).length
							: (held?.length ?? 0))
					);
				}, 0),
		};
	}

	lock(key: string): Lock {
		const at = this.full(key);
		let lock = this.held.locks.get(at);
		if (lock === undefined) {
			lock = new MemoryLock();
			this.held.locks.set(at, lock);
		}
		return lock;
	}

	watch(key: string, opts: WatchOptions = {}): Watch {
		const watch: Watching = {
			at: this.full(key),
			root: this.root,
			recursive: opts.recursive ?? false,
			changes: new Dispatcher<StorageChanges>(),
		};
		this.held.watches.add(watch);
		return {
			events: watch.changes.events,
			dispose: () => {
				this.held.watches.delete(watch);
				watch.changes.dispose();
			},
		};
	}

	within(key: string): Storage {
		return new MemoryStorage(this.full(key), this.held);
	}

	private full(key: string): string {
		return keyIn(this.root, key);
	}

	private text(at: string): string | null {
		const held = this.held.values.get(at);
		return held === undefined
			? null
			: typeof held === "string"
				? held
				: new TextDecoder().decode(held);
	}

	/** The names of what is held directly under `dir`. */
	private under(dir: string): string[] {
		const prefix = dir === "" ? "" : `${dir}/`;
		return [...this.held.values.keys()]
			.filter(
				(at) => at.startsWith(prefix) && !at.slice(prefix.length).includes("/"),
			)
			.map((at) => at.slice(prefix.length));
	}

	private set(at: string, value: string | Uint8Array): void {
		this.held.values.set(at, value);
		this.changed(at);
	}

	private delete(at: string): void {
		if (this.held.values.delete(at)) {
			this.changed(at);
		}
	}

	/** Tells each watch whose reach `at` is in, as one on the disk would. */
	private changed(at: string): void {
		for (const watch of this.held.watches) {
			const inside = watch.at === "" || at.startsWith(`${watch.at}/`);
			const direct =
				at === watch.at ||
				(inside &&
					!at.slice(watch.at === "" ? 0 : watch.at.length + 1).includes("/"));
			if (direct || (watch.recursive && inside)) {
				const relative =
					watch.root === "" ? at : at.slice(watch.root.length + 1);
				watch.changes.dispatch("changed", relative);
			}
		}
	}
}

/** What a `MemoryStorage` and every view of it share. */
interface Held {
	values: Map<string, string | Uint8Array>;
	locks: Map<string, Lock>;
	watches: Set<Watching>;
}

interface Watching {
	at: string;
	/** The root of the storage that watches, which the keys it is told are relative to. */
	root: string;
	recursive: boolean;
	changes: Dispatcher<StorageChanges>;
}

/** The segment `log` rotates out, failing a test whose log had nothing to rotate. */
export async function rotated<T>(log: Log<T>): Promise<Segment> {
	const segment = await log.rotate();
	if (segment === null) {
		throw new Error(`${log.key} had nothing to rotate`);
	}
	return segment;
}
