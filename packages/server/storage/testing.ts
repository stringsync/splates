import { Dispatcher } from "webappwiz/events";
import { type Fs, type Lock, MemoryLock } from "webappwiz/system";
import { replace } from "./atomic";
import type { Collection } from "./collection";
import type { Document, DocumentOptions } from "./document";
import { documentText, entriesOf, logLines } from "./json";
import { checkName, keyIn } from "./key";
import type { Log, LogOptions, Segment } from "./log";
import type {
	Kept,
	Storage,
	StorageChanges,
	Watch,
	WatchOptions,
} from "./storage";

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
			logs: new Set(),
			locks: new Map(),
			watches: new Set(),
			cache: null,
		},
	) {}

	/**
	 * One that `materialize`s into files under `dir` on `fs`, as a storage
	 * with no files of its own would for an agent to read.
	 */
	static cachedIn(dir: string, fs: Fs): MemoryStorage {
		return new MemoryStorage("", {
			values: new Map(),
			logs: new Set(),
			locks: new Map(),
			watches: new Set(),
			cache: { dir, fs },
		});
	}

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
			exists: async () => this.text(at) !== null,
			append: async (...entries) => {
				if (entries.length > 0) {
					this.set(at, (this.text(at) ?? "") + logLines(entries), true);
				}
			},
			replay: async () => entriesOf(this.text(at) ?? "", opts.schema),
			first: async () => entriesOf(this.text(at) ?? "", opts.schema)[0] ?? null,
			compact: async (merge) => {
				const entries = entriesOf(this.text(at) ?? "", opts.schema);
				const merged = merge(entries);
				if (merged.length < entries.length) {
					this.set(at, logLines(merged), true);
				}
			},
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
				this.set(segmentAt(segment), raw, true);
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
			ensure: async () => {},
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
			entries: async () =>
				this.under(dir)
					.sort()
					.map((name) => {
						const held = value(name);
						return {
							name,
							size:
								typeof held === "string"
									? new TextEncoder().encode(held).length
									: (held?.length ?? 0),
						};
					}),
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

	locate(key: string): string {
		return `/memory/${this.full(key)}`;
	}

	async materialize(key: string): Promise<string> {
		const { cache } = this.held;
		if (cache === null) {
			return this.locate(key);
		}
		const at = this.full(key);
		const path = keyIn(cache.dir, at);
		const held = this.held.values.get(at);
		if (held === undefined) {
			await cache.fs.rm(path, { force: true });
		} else {
			await replace(cache.fs, path, held);
		}
		return path;
	}

	async children(key: string): Promise<string[]> {
		const dir = this.full(key);
		const prefix = dir === "" ? "" : `${dir}/`;
		const names = new Set<string>();
		for (const at of this.held.values.keys()) {
			const rest = at.startsWith(prefix) ? at.slice(prefix.length) : "";
			const slash = rest.indexOf("/");
			if (slash > 0) {
				names.add(rest.slice(0, slash));
			}
		}
		return [...names].sort();
	}

	async size(key: string): Promise<number> {
		const dir = this.full(key);
		let total = 0;
		for (const [at, held] of this.held.values) {
			if (at.startsWith(`${dir}/`)) {
				total +=
					typeof held === "string"
						? new TextEncoder().encode(held).length
						: held.length;
			}
		}
		return total;
	}

	async keys(key: string): Promise<string[]> {
		const dir = this.full(key);
		const prefix = dir === "" ? "" : `${dir}/`;
		return [...this.held.values.keys()]
			.filter((at) => at.startsWith(prefix))
			.map((at) => this.relative(at))
			.sort();
	}

	async copy(key: string, from = 0): Promise<Kept | null> {
		const at = this.full(key);
		const held = this.held.values.get(at);
		if (held === undefined) {
			return null;
		}
		if (!this.held.logs.has(at)) {
			return {
				kind: "value",
				bytes: typeof held === "string" ? new TextEncoder().encode(held) : held,
			};
		}
		const lines = (this.text(at) ?? "").split("\n").filter(Boolean);
		return { kind: "log", lines: lines.slice(from), count: lines.length };
	}

	async remove(key: string): Promise<void> {
		const dir = this.full(key);
		for (const at of [...this.held.values.keys()]) {
			if (at === dir || at.startsWith(`${dir}/`)) {
				this.delete(at);
			}
		}
	}

	within(key: string): Storage {
		return new MemoryStorage(this.full(key), this.held);
	}

	private full(key: string): string {
		return keyIn(this.root, key);
	}

	private relative(at: string): string {
		return this.root === "" ? at : at.slice(this.root.length + 1);
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

	private set(at: string, value: string | Uint8Array, log = false): void {
		this.held.values.set(at, value);
		if (log) {
			this.held.logs.add(at);
		} else {
			this.held.logs.delete(at);
		}
		this.changed(at);
	}

	private delete(at: string): void {
		this.held.logs.delete(at);
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
	/** Which of `values` are logs or their segments. */
	logs: Set<string>;
	locks: Map<string, Lock>;
	watches: Set<Watching>;
	/** Where `materialize` writes copies; null to answer `locate`'s path. */
	cache: { dir: string; fs: Fs } | null;
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
