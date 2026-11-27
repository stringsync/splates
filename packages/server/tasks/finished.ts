import { basename, relative, resolve, sep } from "node:path";
import type { Fs } from "core/system";
import {
	capturedFileName,
	findInlineMedia,
	readValidatedMedia,
	rewriteInlineMedia,
	validateMedia,
} from "../artifacts";
import { decodeTask, encodeTask } from "../board";
import { ARTIFACT_LIMITS, movedPath } from "../config";
import type { Collection, Storage } from "../storage";
import type { RemoveReason } from "./worktree";

/** Extra sources for resolving local media referenced in a finished task's `SPLATES.md`. */
export interface FinishedRecordOptions {
	/** Directory to resolve relative media paths in `plan` against (e.g. the task's worktree). */
	cwd?: string;
	/** Previously captured local media (`resolved source path -> stored path`), reused if needed. */
	captured?: ReadonlyMap<string, string>;
	/** Validated media bytes pre-read before the worktree was deleted (`resolved source path -> bytes`). */
	preRead?: ReadonlyMap<string, Uint8Array>;
	/** Per-file byte limit for auto-captured local media. */
	maxFileBytes?: number;
	/** Total byte limit for auto-captured local media. */
	maxTotalBytes?: number;
}

/** A task that merged or was removed, as `Finished` keeps it to look back on. */
export interface FinishedTask {
	/** What names it among the finished, apart from a later finish of the same number. */
	key: string;
	/** Its number, which a queued task it was started from goes on holding. */
	id: number;
	task: string;
	/** The first line of its Goal, or of what it was queued as when it had none. */
	subject: string;
	ended: "merged" | "removed";
	/** Why it was removed, when it was and one was given. */
	reason: RemoveReason | null;
	base: string;
	/** The commit it landed as, for one that merged. */
	commit: string | null;
	startedAt: string;
	endedAt: string;
	/** The `splates server` conversation that worked it, or null for none. */
	conversation: string | null;
	/** The queued tasks it took up, which left the queue with it or went back. */
	took: { id: number; subject: string }[];
}

/** A finished task with the `SPLATES.md` it ended on, "" when it had none. */
export interface FinishedPlan extends FinishedTask {
	plan: string;
}

/**
 * Keeps what a finished task did so the page can still show it: the
 * `SPLATES.md` it ended on, and every screenshot or recording it attached,
 * whether or not that plan shows it. Record a task with `record`; read it
 * back with `list` and `read`, and find a vanished attached file's copy with
 * `copyOf`. Only the newest tasks up to the capacity are kept.
 */
export class Finished {
	private readonly records: Collection;
	/** What `list` last read, kept in step by `record`, so a call reads nothing. */
	#listed: FinishedTask[] | null = null;
	/** Where the kept records can be opened. */
	readonly dir: string;

	constructor(
		/** The project's, holding `finished/`. */
		private readonly storage: Storage,
		/** Reads the attached files a plan names, which are named by absolute path. */
		private readonly fs: Fs,
		/** How many it keeps, the oldest going first. */
		private readonly capacity: number,
		/** How many of the newest keep copies of their attached files. */
		private readonly attachmentCapacity: number = FINISHED_ATTACHMENT_CAPACITY,
	) {
		this.records = storage.collection("finished");
		this.dir = storage.locate("finished");
	}

	/**
	 * Keeps `finished`, with a copy of each file its plan names that
	 * `attached` says is one a task held or that validates as local media,
	 * the plan rewritten to name the copy, which it returns.
	 */
	async record(
		finished: Omit<FinishedPlan, "key">,
		attached: (path: string) => boolean = () => false,
		/** Attached files the task held, kept whether or not the plan names them. */
		held: string[] = [],
		opts: FinishedRecordOptions = {},
	): Promise<string> {
		const key = `${finished.id}-${Date.parse(finished.endedAt) || 0}`;
		const { plan: ended, ...facts } = finished;
		const plan = await this.keep(key, ended, attached, held, opts);
		await this.records.write(
			recordName(key),
			encodeTask({ ...facts, key, text: plan }),
		);
		if (this.#listed !== null) {
			const { plan: _, ...facts } = (await this.read(key)) as FinishedPlan;
			this.#listed = [
				...this.#listed.filter((each) => each.key !== key),
				facts,
			].sort(newestFirst);
		}
		// Trimmed by the names alone, which hold each one's end time, so a
		// finish does not read every record kept.
		const newest = (await this.records.list())
			.filter((each) => KEY_FILE.test(each))
			.map((each) => each.slice(0, -".md".length))
			.sort(newestKeyFirst);
		for (const old of newest.slice(this.capacity)) {
			await this.records.remove(recordName(old));
			await this.storage.remove(this.filesKey(old));
			this.#listed = null;
		}
		for (const old of newest.slice(this.attachmentCapacity, this.capacity)) {
			await this.storage.remove(this.filesKey(old));
		}
		return plan;
	}

	/**
	 * Whether `path` is a file kept with a finished task, one level inside
	 * its `<key>/`, and not a way out of here.
	 */
	owns(path: string): boolean {
		const parts = relative(this.dir, resolve(path)).split(sep);
		return (
			parts.length === 2 &&
			KEY.test(parts[0] ?? "") &&
			parts[1] !== ".." &&
			parts[1] !== ""
		);
	}

	/**
	 * `plan` naming copies, kept under `key`, of the attached files it named,
	 * which go on to show once their conversation or task is gone. A file
	 * that can no longer be read is left named as it was.
	 */
	private async keep(
		key: string,
		plan: string,
		attached: (path: string) => boolean,
		held: string[] = [],
		opts: FinishedRecordOptions = {},
	): Promise<string> {
		const keptPlain = new Map<string, string>();
		const mdReplacements = new Map<string, string>();
		const taken = new Set<string>();
		const copiedSource = new Map<string, string>();
		const copiedHash = new Map<string, string>();
		const files = this.storage.collection(this.filesKey(key));
		const maxFileBytes = opts.maxFileBytes ?? ARTIFACT_LIMITS.file;
		const maxTotalBytes = opts.maxTotalBytes ?? ARTIFACT_LIMITS.conversation;
		let autoCapturedBytes = 0;

		const saveCopy = async (
			sourceName: string,
			bytes: Uint8Array,
		): Promise<string> => {
			const base = basename(sourceName);
			let name = base;
			for (let copies = 2; taken.has(name); copies++) {
				name = `${copies}-${base}`;
			}
			taken.add(name);
			await files.writeBytes(name, bytes);
			return this.storage.materialize(`${this.filesKey(key)}/${name}`);
		};

		// Map held files by basename so auto-captured plan refs matching an
		// already-held content-addressed file reuse the same stored copy.
		const heldByName = new Map<string, string>();
		for (const path of held) {
			heldByName.set(basename(path), path);
		}

		// 1. Copy attached paths named in the plan (including bare paths in text).
		for (const named of new Set(plan.match(PATH) ?? [])) {
			const path = movedPath(named);
			if (!attached(path)) {
				continue;
			}
			const existing = copiedSource.get(path);
			if (existing !== undefined) {
				keptPlain.set(named, existing);
				continue;
			}
			const bytes = await this.fs.readBytes(path).catch(() => null);
			if (bytes === null) {
				continue;
			}
			const dest = await saveCopy(path, bytes);
			copiedSource.set(path, dest);
			keptPlain.set(named, dest);
		}

		// 2. Copy validated local Markdown media references outside code blocks.
		const seenRaw = new Set<string>();
		for (const ref of findInlineMedia(plan, opts.cwd ?? null)) {
			if (seenRaw.has(ref.raw) || keptPlain.has(ref.raw)) {
				continue;
			}
			seenRaw.add(ref.raw);
			const normalized = movedPath(ref.resolved);
			if (attached(normalized)) {
				const existing = copiedSource.get(normalized);
				if (existing !== undefined) {
					mdReplacements.set(ref.raw, existing);
					continue;
				}
				const bytes = await this.fs.readBytes(normalized).catch(() => null);
				if (bytes !== null) {
					const dest = await saveCopy(normalized, bytes);
					copiedSource.set(normalized, dest);
					mdReplacements.set(ref.raw, dest);
				}
				continue;
			}

			let bytes: Uint8Array | null = null;
			const preRead = opts.preRead?.get(ref.resolved);
			if (
				preRead !== undefined &&
				preRead.length > 0 &&
				preRead.length <= maxFileBytes &&
				validateMedia(ref.resolved, preRead) !== null
			) {
				bytes = preRead;
			} else {
				const valid = await readValidatedMedia(
					this.fs,
					ref.resolved,
					maxFileBytes,
				);
				if (valid !== null) {
					bytes = valid.bytes;
				}
			}

			if (bytes !== null) {
				const sig = capturedFileName(bytes, ref.resolved);
				const dup = copiedHash.get(sig);
				if (dup !== undefined) {
					mdReplacements.set(ref.raw, dup);
					continue;
				}
				const heldMatch = heldByName.get(sig);
				const heldNorm = heldMatch === undefined ? null : movedPath(heldMatch);
				if (heldNorm !== null && copiedSource.has(heldNorm)) {
					const dest = copiedSource.get(heldNorm) as string;
					copiedHash.set(sig, dest);
					mdReplacements.set(ref.raw, dest);
					continue;
				}
				if (autoCapturedBytes + bytes.length > maxTotalBytes) {
					continue;
				}
				const dest = await saveCopy(
					heldMatch !== undefined ? sig : ref.resolved,
					bytes,
				);
				autoCapturedBytes += bytes.length;
				copiedHash.set(sig, dest);
				if (heldNorm !== null) {
					copiedSource.set(heldNorm, dest);
				}
				mdReplacements.set(ref.raw, dest);
				continue;
			}

			// Source file no longer exists on disk: reuse conversation-captured copy if present.
			if (!(await this.fs.exists(ref.resolved))) {
				const fallback = opts.captured?.get(ref.resolved);
				if (fallback === undefined) {
					continue;
				}
				const normFallback = movedPath(fallback);
				const existing = copiedSource.get(normFallback);
				if (existing !== undefined) {
					mdReplacements.set(ref.raw, existing);
					continue;
				}
				const copied = await this.fs.readBytes(normFallback).catch(() => null);
				if (
					copied === null ||
					copied.length === 0 ||
					copied.length > maxFileBytes ||
					(!attached(normFallback) &&
						validateMedia(normFallback, copied) === null) ||
					autoCapturedBytes + copied.length > maxTotalBytes
				) {
					continue;
				}
				const dest = await saveCopy(normFallback, copied);
				autoCapturedBytes += copied.length;
				copiedSource.set(normFallback, dest);
				mdReplacements.set(ref.raw, dest);
			}
		}

		// 3. Copy remaining held files that the plan did not name so `copyOf` finds them.
		for (const path of held) {
			const normalized = movedPath(path);
			if (copiedSource.has(normalized)) {
				continue;
			}
			const bytes = await this.fs.readBytes(path).catch(() => null);
			if (bytes === null) {
				continue;
			}
			const dest = await saveCopy(path, bytes);
			copiedSource.set(normalized, dest);
		}

		const rewritten = rewriteInlineMedia(plan, mdReplacements);
		return keptPlain.size === 0
			? rewritten
			: rewritten.replace(PATH, (named) => keptPlain.get(named) ?? named);
	}

	/**
	 * Where the copy of a file `task` held now is, by started task name or
	 * numbered board task, so a reply naming its old path still shows it.
	 */
	async copyOf(task: string | number, name: string): Promise<string | null> {
		const entries = (await this.list())
			.filter((each) =>
				typeof task === "string"
					? each.task === task
					: each.took.some((taken) => taken.id === task),
			)
			.sort((later, earlier) => earlier.endedAt.localeCompare(later.endedAt));
		for (const { key } of entries) {
			const copy = `${this.dir}/${key}/${name}`;
			if (await this.fs.exists(copy)) {
				return copy;
			}
		}
		return null;
	}

	private filesKey(key: string): string {
		return `finished/${key}`;
	}

	/** Every one kept, the latest to finish first, without its plan. */
	async list(): Promise<FinishedTask[]> {
		if (this.#listed === null) {
			const entries = await this.records.list();
			const kept: FinishedTask[] = [];
			for (const entry of entries.filter((each) => KEY_FILE.test(each))) {
				const found = await this.read(entry.slice(0, -".md".length));
				if (found !== null) {
					const { plan: _, ...facts } = found;
					kept.push(facts);
				}
			}
			this.#listed = kept.sort(newestFirst);
		}
		return [...this.#listed];
	}

	/** The one kept as `key`, with its plan, or null for none. */
	async read(key: string): Promise<FinishedPlan | null> {
		if (!KEY.test(key)) {
			return null;
		}
		const raw = await this.records.read(recordName(key)).catch(() => null);
		const fields = raw === null ? null : decodeTask(raw);
		if (fields === null) {
			return null;
		}
		const { text, ...facts } = fields as unknown as FinishedTask & {
			text: string;
		};
		return { ...facts, plan: text };
	}
}

function recordName(key: string): string {
	return `${key}.md`;
}

const KEY = /^\d+-\d+$/;

/**
 * An absolute path as a plan names one, in `![what](/path)`, `(<\/path>)` or
 * running text; attached files' names hold no spaces, and a sentence's
 * closing stop is left off.
 */
const PATH = /\/[^\s()<>[\]"'`]*[^\s()<>[\]"'`.,;:!?]/g;
const KEY_FILE = /^\d+-\d+\.md$/;

/** How many of the newest finished tasks keep copies of their attached files. */
export const FINISHED_ATTACHMENT_CAPACITY = 5000;

function newestFirst(left: FinishedTask, right: FinishedTask): number {
	return right.endedAt.localeCompare(left.endedAt) || right.id - left.id;
}

/** Keys newest first by the end time and number they are named for. */
function newestKeyFirst(left: string, right: string): number {
	const [leftId = 0, leftEnd = 0] = left.split("-").map(Number);
	const [rightId = 0, rightEnd = 0] = right.split("-").map(Number);
	return rightEnd - leftEnd || rightId - leftId;
}
