import { type Fs, NodeFs } from "webappwiz/system";
import type { Entry, Journal } from "./journal";
import { DEFAULT_COUNT } from "./log";
import { type Details, taskDetails } from "./show";
import type { WorktreeService } from "./worktree-service";

/** Everything one page shows: `ls` and `show` for each task, plus `log`. */
export interface Snapshot {
	tasks: Details[];
	entries: Entry[];
}

/**
 * Reads the whole repo the way `ls`, `show` and `log` do. Takes no lease, so
 * serving a page cannot knock an agent off the tree it is driving.
 */
export interface SnapshotOptions {
	/** What the worktrees are read through; the real filesystem by default. */
	fs?: Fs;
}

export async function snapshot(
	service: WorktreeService,
	journal: Journal,
	opts: SnapshotOptions = {},
): Promise<Snapshot> {
	const fs = opts.fs ?? new NodeFs();
	const tasks: Details[] = [];
	for (const worktree of await service.list()) {
		tasks.push(await taskDetails(worktree, { fs }));
	}
	return { tasks, entries: await journal.tail(DEFAULT_COUNT) };
}

/**
 * What the page is actually showing, minus the fields that move on their own.
 * `age` ticks every minute, and hashing it would push to every open page for
 * nothing.
 */
export function fingerprint({ tasks, entries }: Snapshot): string {
	return JSON.stringify([
		tasks.map((task) => [
			task.task,
			task.status,
			task.lease,
			task.ahead,
			task.added,
			task.removed,
			task.escalation,
			task.plan,
			task.planProblems,
		]),
		entries.length,
		entries.at(-1)?.at ?? null,
	]);
}
