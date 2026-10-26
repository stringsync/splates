import type { MergeEstimates } from "@stringsync/splates-server/merge";
import type {
	Landed,
	PeriodId,
	Stats,
} from "@stringsync/splates-server/stats/browser";
import type { FileDiff } from "@stringsync/splates-server/tasks";
import { ApiError, answered, scoped, send, sendJson } from "./request";

/**
 * The files and directories (ending in `/`) a task's tree holds, or the main
 * tree's for none: what `@` offers.
 */
export async function paths(task = ""): Promise<string[]> {
	const response = await answered(
		scoped(`/api/paths?${new URLSearchParams({ task })}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/paths: ${response.status}`);
	}
	return (await response.json()) as string[];
}

/** What `task` changed against its base, uncommitted edits included. */
export async function taskDiff(task: string): Promise<FileDiff[]> {
	const response = await answered(
		scoped(`/api/tasks/${encodeURIComponent(task)}/diff`),
	);
	if (!response.ok) {
		throw new ApiError("error", `${task}'s diff: ${response.status}`);
	}
	return (await response.json()) as FileDiff[];
}

/** How long each step and premerge phase of a merge usually takes here. */
export async function mergeEstimates(): Promise<MergeEstimates> {
	const response = await answered(scoped("/api/merge-estimates"));
	if (!response.ok) {
		throw new ApiError("error", `/api/merge-estimates: ${response.status}`);
	}
	return (await response.json()) as MergeEstimates;
}

/**
 * How `task` went once it merged, beside its project's week before; null
 * when it never merged here.
 */
export async function taskOutcome(task: string): Promise<Landed | null> {
	const response = await answered(
		scoped(`/api/tasks/${encodeURIComponent(task)}/outcome`),
	);
	if (!response.ok) {
		throw new ApiError("error", `${task}'s outcome: ${response.status}`);
	}
	return (await response.json()) as Landed | null;
}

/**
 * Gives `task`, once it spent its merge attempts, another round of them, as
 * `splates retry` does.
 */
export async function retryTask(task: string): Promise<void> {
	await send(`/api/tasks/${encodeURIComponent(task)}/retry`, {});
}

/**
 * `splates remove` for `task`, past any lease, stopping each conversation in
 * its tree and moving it to the main tree.
 */
export async function removeTask(task: string): Promise<void> {
	await send(`/api/tasks/${encodeURIComponent(task)}`, { method: "DELETE" });
}

/**
 * How tasks ended across every project, summed for the Stats page over
 * `period`, narrowed to the main tree `project` when given.
 */
export async function stats(
	period: PeriodId,
	project?: string,
): Promise<Stats> {
	const path = `/api/stats?period=${period}${project === undefined ? "" : `&project=${encodeURIComponent(project)}`}`;
	const response = await answered(path);
	if (!response.ok) {
		throw new ApiError("error", `${path}: ${response.status}`);
	}
	return (await response.json()) as Stats;
}

/**
 * Opens `path` in `editor` on this machine, inside the tree it belongs to,
 * at `line` when there is one.
 */
export async function openFile(
	editor: string,
	path: string,
	line: number | null,
): Promise<void> {
	await sendJson("/api/open", "POST", { editor, path, line });
}
