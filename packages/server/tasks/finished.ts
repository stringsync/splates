import type { Fs } from "webappwiz/system";
import { decodeTask, encodeTask } from "../board";
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
}

/** A finished task with the `SPLATES.md` it ended on, "" when it had none. */
export interface FinishedPlan extends FinishedTask {
	plan: string;
}

/**
 * Every task that has finished in a repo, newest kept, in
 * `.git/splates/finished/<key>.md`: its facts as front matter and the
 * `SPLATES.md` it ended on as the body, so the page can show what it did
 * once its tree and record are gone.
 */
export class Finished {
	constructor(
		readonly dir: string,
		private readonly fs: Fs,
		/** How many it keeps, the oldest going first. */
		private readonly capacity = FINISHED_KEPT,
	) {}

	async record(finished: Omit<FinishedPlan, "key">): Promise<void> {
		const key = `${finished.id}-${Date.parse(finished.endedAt) || 0}`;
		const { plan, ...facts } = finished;
		await this.fs.mkdir(this.dir);
		await this.fs.write(
			this.path(key),
			encodeTask({ ...facts, key, text: plan }),
		);
		const listed = await this.list();
		for (const old of listed.slice(this.capacity)) {
			await this.fs.rm(this.path(old.key), { force: true });
		}
	}

	/** Every one kept, the latest to finish first, without its plan. */
	async list(): Promise<FinishedTask[]> {
		const entries = await this.fs.readdir(this.dir).catch(() => []);
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
		const raw = await this.fs.read(this.path(key)).catch(() => null);
		const fields = raw === null ? null : decodeTask(raw);
		if (fields === null) {
			return null;
		}
		const { text, ...facts } = fields as unknown as FinishedTask & {
			text: string;
		};
		return { ...facts, plan: text };
	}

	private path(key: string): string {
		return `${this.dir}/${key}.md`;
	}
}

/** How many finished tasks a repo keeps by default. */
export const FINISHED_KEPT = 500;

const KEY = /^\d+-\d+$/;
const KEY_FILE = /^\d+-\d+\.md$/;
