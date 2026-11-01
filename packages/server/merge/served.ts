import type { Logger } from "core/log";
import { z } from "zod";
import { Exit, type Reason } from "../exit";
import type { Facts } from "../records";
import type { Storage } from "../storage";
import { Run } from "./served-run";

/** What `splates merge` asks the server to merge: its task, as it would have run it. */
export const MergeAsk = z.object({
	task: z.string(),
	/** The task's worktree, where `splates merge` ran. */
	cwd: z.string(),
	/** The `splates merge` waiting on it, which the task's lease goes back to. */
	pid: z.number(),
	hostname: z.string(),
	/** Its environment, which the gate runs with. */
	env: z.record(z.string(), z.string()),
	message: z.string(),
	/**
	 * Set for a worker on another machine with a central remote: its branch,
	 * pushed untested as `splates/<task>` at `head`, is what the server
	 * merges in a checkout of its own, `cwd` being the worker's. The counts
	 * are the task's merge budget spent so far, which the server charges and
	 * a refusal returns.
	 */
	remote: z
		.object({
			head: z.string(),
			attempts: z.number(),
			conflicts: z.number(),
		})
		.optional(),
});
export type MergeAsk = z.infer<typeof MergeAsk>;

/** A line a merge logged, for `splates merge` to print as its own. */
export interface MergeLog {
	level: "info" | "error";
	text: string;
}

/** How a merge ended: landed with no `exit`, refused with one, or broken with an `error`. */
export interface MergeEnd {
	facts: Partial<Facts["merge"]>;
	exit?: { reason: Reason; message: string; data: Record<string, unknown> };
	error?: string;
}

/** What a merge has said since `from`, and how it ended once it has. */
export interface MergeAnswer {
	lines: MergeLog[];
	/** How many lines it has said in all, the `from` to read on from. */
	next: number;
	end: MergeEnd | null;
}

/** Runs one merge as the server's own, logging to `log` and filling `facts`. */
export type RunMerge = (
	ask: MergeAsk,
	log: Logger,
	facts: Partial<Facts["merge"]>,
) => Promise<void>;

/** A merge's record, kept until `splates merge` has read how it ended. */
interface Kept {
	ask: MergeAsk;
	/** Set once it ended, with every line it said. */
	ended?: { lines: MergeLog[]; end: MergeEnd };
}

/**
 * The merges `splates merge` hands the server, one per task, each run by
 * the server's own merge code and read back by the command waiting on it.
 * Each is kept on disk until read, so a restart loses none: the command
 * asks again and the merge runs again, or it reads the end it missed.
 */
export class ServedMerges {
	private readonly runs = new Map<string, Run>();

	constructor(
		private readonly deps: {
			storage: Storage;
			log: Logger;
			run: RunMerge;
		},
	) {}

	private get records() {
		return this.deps.storage.collection("merge-queue");
	}

	/**
	 * Starts `ask`'s merge, or carries on with one already under way for
	 * the same `splates merge`. Refuses another while one runs for the task.
	 */
	async start(ask: MergeAsk): Promise<void> {
		const running = this.runs.get(ask.task);
		if (running !== undefined) {
			if (running.ask.pid === ask.pid) {
				return;
			}
			if (running.end === null) {
				throw new Exit(
					"blocked",
					`a merge of '${ask.task}' is already under way for pid ${running.ask.pid}: wait for it, or stop that \`splates merge\`.`,
					{ task: ask.task },
				);
			}
		}
		const kept = await this.kept(ask.task);
		if (kept?.ended !== undefined && kept.ask.pid === ask.pid) {
			this.runs.set(ask.task, Run.ended(ask, kept.ended));
			return;
		}
		const run = new Run(ask);
		this.runs.set(ask.task, run);
		await this.records.write(ask.task, JSON.stringify({ ask } satisfies Kept));
		void this.go(run);
	}

	/**
	 * What `task`'s merge has said since `from`, waiting up to `waitMs` for
	 * more while it runs; null when the server has none for the task.
	 */
	async read(
		task: string,
		from: number,
		waitMs: number,
	): Promise<MergeAnswer | null> {
		const run = this.runs.get(task);
		if (run === undefined) {
			return null;
		}
		await run.more(from, waitMs);
		return {
			lines: run.lines.slice(from),
			next: run.lines.length,
			end: run.end,
		};
	}

	/** Forgets `task`'s ended merge, once its `splates merge` has read the end. */
	async done(task: string, pid: number): Promise<void> {
		const run = this.runs.get(task);
		if (run === undefined || run.ask.pid !== pid || run.end === null) {
			return;
		}
		this.runs.delete(task);
		await this.records.remove(task);
	}

	/** Whether a merge for `task` is under way here. */
	running(task: string): boolean {
		const run = this.runs.get(task);
		return run !== undefined && run.end === null;
	}

	private async go(run: Run): Promise<void> {
		const facts: Partial<Facts["merge"]> = {};
		let end: MergeEnd;
		try {
			await this.deps.run(run.ask, run.logger, facts);
			end = { facts };
		} catch (error) {
			end =
				error instanceof Exit
					? {
							facts,
							exit: {
								reason: error.reason,
								message: error.message,
								data: error.data,
							},
						}
					: {
							facts,
							error: error instanceof Error ? error.message : String(error),
						};
			if (!(error instanceof Exit)) {
				this.deps.log.error(
					`the merge of ${run.ask.task} broke: ${end.error ?? ""}`,
				);
			}
		}
		// Kept before it is told, so a command that reads the end and says so
		// never has the record written back after it is forgotten.
		try {
			await this.records.write(
				run.ask.task,
				JSON.stringify({
					ask: run.ask,
					ended: { lines: run.lines, end },
				} satisfies Kept),
			);
		} catch (error) {
			this.deps.log.error(
				`could not keep how the merge of ${run.ask.task} ended: ${error}`,
			);
		}
		run.finish(end);
	}

	private async kept(task: string): Promise<Kept | null> {
		const raw = await this.records.read(task);
		if (raw === null) {
			return null;
		}
		try {
			return JSON.parse(raw) as Kept;
		} catch {
			return null;
		}
	}
}
