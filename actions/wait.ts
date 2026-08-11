import { color, type Logger } from "@webappwiz/log";
import { Duration, sleep } from "@webappwiz/time";
import { fail } from "../lib/exit";
import type { Worktree, WorktreeStatus } from "../lib/worktree";
import type { WorktreeStore } from "../lib/worktree-store";

/** How the wait ended, once nothing is going to move on its own any more. */
type Rest = "gone" | "escalated" | "broken";

export const DEFAULT_TIMEOUT = Duration.mins(30);
/** Same interval the graft lock polls on: cheap enough, quick enough. */
const POLL = Duration.secs(2);

/**
 * Blocks until a task stops moving: it lands or is pruned, it escalates, or it
 * falls apart. This is what an agent does instead of starting work that
 * overlaps a task already in flight — the overlap disappears when that task
 * grafts, and starting now buys a rebase conflict instead.
 *
 * Giving up is a refusal (`timed_out`), because a task still working after the
 * whole budget is a question for a human, not a result.
 */
export async function wait(
	{ store, log }: { store: WorktreeStore; log: Logger },
	task: string,
	{
		timeout = DEFAULT_TIMEOUT,
		poll = POLL,
		json = false,
	}: { timeout?: Duration; poll?: Duration; json?: boolean } = {},
): Promise<void> {
	const started = Date.now();
	const waited = (): Duration => Duration.ms(Date.now() - started);

	let worktree = await store.find(task);
	// A name that was never here will never rest, so say so now rather than
	// spending the budget on it. A pruned one, by contrast, has already rested.
	if (worktree.status === "absent") {
		fail(
			"not_found",
			`no task '${task}' — run \`arbor ls\` to see what there is`,
			{
				task,
			},
		);
	}

	// Discarding a task removes its directory before its record, so a tree being
	// grafted or pruned reads as `orphaned` in between. A broken status is only
	// believed once it survives a poll — anything that resolves faster than the
	// interval was someone else's landing, not a broken tree.
	let previous: WorktreeStatus | null = null;

	for (;;) {
		const rest = restOf(worktree);
		if (rest !== null && (rest !== "broken" || worktree.status === previous)) {
			log.info(
				json
					? JSON.stringify(
							{
								task,
								rest,
								status: worktree.status,
								escalation: escalationOf(worktree),
								waitedMs: waited().ms,
							},
							null,
							"\t",
						)
					: report(worktree, rest, waited()),
			);
			return;
		}
		previous = worktree.status;
		const left = timeout.subtract(waited());
		if (!left.isGreaterThan(Duration.zero())) {
			fail(
				"timed_out",
				`'${task}' is still ${worktree.status} after ${waited().human()} — ask whether to keep waiting, work alongside it, or do something else`,
				{ task, status: worktree.status, waitedMs: waited().ms },
			);
		}
		// Never sleep past the deadline: a timeout shorter than the poll interval
		// should still be honoured to the second.
		await sleep(Duration.min(poll, left));
		worktree = await worktree.reload();
	}
}

/** Null while an agent could still be driving this; otherwise how it rests. */
function restOf(worktree: Worktree): Rest | null {
	switch (worktree.status) {
		case "working":
		case "grafting":
			return null;
		case "escalated":
			return "escalated";
		case "pruned":
		case "absent":
			return "gone";
		// orphaned, stray, unrecorded, unknown: nothing left to drive it.
		default:
			return "broken";
	}
}

function escalationOf(worktree: Worktree): string | null {
	return worktree.state?.escalations?.at(-1)?.reason ?? null;
}

function report(worktree: Worktree, rest: Rest, waited: Duration): string {
	const { task, status } = worktree;
	const took = `(waited ${waited.human()})`;
	if (rest === "gone") {
		return `${color.green("gone")} ${task} — grafted or pruned, nothing of it is left ${took}`;
	}
	if (rest === "escalated") {
		return [
			`${color.yellow("escalated")} ${task}: ${escalationOf(worktree) ?? "no reason recorded"} ${took}`,
			`  it is waiting on a person — \`arbor show ${task}\` for what it needs`,
		].join("\n");
	}
	return [
		`${color.yellow(status)} ${task} — nothing is driving it ${took}`,
		`  \`arbor show ${task}\` for what is left of it`,
	].join("\n");
}
