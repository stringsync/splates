import { basename, relative, resolve, sep } from "node:path";
import type { Fs } from "core/system";
import { decodeTask, encodeTask } from "../board";
import { movedPath } from "../config";
import type { Collection, Storage } from "../storage";
import type { RemoveReason } from "./worktree";

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
	/** Whether the plan it ended on has a `## Demo` saying how to show it. */
	hasDemo: boolean;
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
	/** Where the kept records can be opened. */
	readonly dir: string;

	constructor(
		/** The project's, holding `finished/`. */
		private readonly storage: Storage,
		/** Reads the attached files a plan names, which are named by absolute path. */
		private readonly fs: Fs,
		/** How many it keeps, the oldest going first. */
		private readonly capacity: number,
	) {
		this.records = storage.collection("finished");
		this.dir = storage.locate("finished");
	}

	/**
	 * Keeps `finished`, with a copy of each file its plan names that
	 * `attached` says is one a task held, the plan rewritten to name the copy.
	 */
	async record(
		finished: Omit<FinishedPlan, "key" | "hasDemo">,
		attached: (path: string) => boolean = () => false,
		/** Attached files the task held, kept whether or not the plan names them. */
		held: string[] = [],
	): Promise<void> {
		const key = `${finished.id}-${Date.parse(finished.endedAt) || 0}`;
		const { plan: ended, ...facts } = finished;
		const plan = await this.keep(key, ended, attached, held);
		await this.records.write(
			recordName(key),
			encodeTask({ ...facts, key, text: plan }),
		);
		const listed = await this.list();
		for (const old of listed.slice(this.capacity)) {
			await this.records.remove(recordName(old.key));
			await this.storage.remove(this.filesKey(old.key));
		}
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
	): Promise<string> {
		const kept = new Map<string, string>();
		const taken = new Set<string>();
		const named = new Set(plan.match(PATH) ?? []);
		// Files a reply showed but the plan does not name keep by name, so
		// `copyOf` can find them once the old path is gone.
		for (const path of held) {
			if (named.has(path)) {
				continue;
			}
			const bytes = await this.fs.readBytes(path).catch(() => null);
			if (bytes === null) {
				continue;
			}
			let name = basename(path);
			for (let copies = 2; taken.has(name); copies++) {
				name = `${copies}-${basename(path)}`;
			}
			taken.add(name);
			await this.storage.collection(this.filesKey(key)).writeBytes(name, bytes);
		}
		for (const named of new Set(plan.match(PATH) ?? [])) {
			const path = movedPath(named);
			if (!attached(path)) {
				continue;
			}
			const bytes = await this.fs.readBytes(path).catch(() => null);
			if (bytes === null) {
				continue;
			}
			let name = basename(path);
			for (let copies = 2; taken.has(name); copies++) {
				name = `${copies}-${basename(path)}`;
			}
			taken.add(name);
			const files = this.storage.collection(this.filesKey(key));
			await files.writeBytes(name, bytes);
			kept.set(
				named,
				await this.storage.materialize(`${this.filesKey(key)}/${name}`),
			);
		}
		return kept.size === 0
			? plan
			: plan.replace(PATH, (named) => kept.get(named) ?? named);
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
		const entries = await this.records.list();
		const kept: FinishedTask[] = [];
		for (const entry of entries.filter((each) => KEY_FILE.test(each))) {
			const found = await this.read(entry.slice(0, -".md".length));
			if (found !== null) {
				const { plan: _, ...facts } = found;
				kept.push(facts);
			}
		}
		return kept.sort(
			(left, right) =>
				right.endedAt.localeCompare(left.endedAt) || right.id - left.id,
		);
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
		return { ...facts, plan: text, hasDemo: hasDemo(text) };
	}
}

/** Whether `plan` has a `## Demo` with something under it before the next heading. */
function hasDemo(plan: string): boolean {
	const body = /^## Demo[ \t]*\r?\n([\s\S]*?)(?=^#{1,2} |(?![\s\S]))/im.exec(
		plan,
	);
	return body !== null && (body[1] ?? "").trim() !== "";
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
