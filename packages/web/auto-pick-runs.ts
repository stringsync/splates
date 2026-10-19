import type { AutoPicked } from "@stringsync/splates-server/auto-pick";
import type { TaskRecord } from "@stringsync/splates-server/board/browser";
import type { Details } from "@stringsync/splates-server/tasks";

/** One start Auto pick decided, as the task it started keeps it. */
export interface AutoPickRun {
	/** What names it in a list: a started task's name, or a queued one's number. */
	key: string;
	/** The started task it was for, or null for a queued one. */
	task: string | null;
	/** The queued task it was for, or null for a started one. */
	todo: number | null;
	/** What to call the task: its name, or the queued one's subject. */
	name: string;
	picked: AutoPicked;
}

/**
 * Every Auto pick the page's tasks keep, newest first: each started task's
 * last pick, and each queued task's that no started task carries yet.
 */
export function autoPickRuns(
	tasks: readonly Details[],
	todos: readonly TaskRecord[],
): AutoPickRun[] {
	const started = tasks.flatMap((each) =>
		each.autoPick === null
			? []
			: [
					{
						key: each.task,
						task: each.task,
						todo: null,
						name: each.task,
						picked: each.autoPick,
					},
				],
	);
	const queued = todos.flatMap((each) =>
		each.autoPick === undefined ||
		started.some((run) => run.task === each.takenBy)
			? []
			: [
					{
						key: `#${each.id}`,
						task: null,
						todo: each.id,
						name: `#${each.id} ${each.subject}`,
						picked: each.autoPick,
					},
				],
	);
	return [...started, ...queued].toSorted((one, other) =>
		other.picked.at.localeCompare(one.picked.at),
	);
}
