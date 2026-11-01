import { deferralBlockers } from "@stringsync/splates-server/board/browser";
import {
	type Needing,
	unanswered,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useContext, useMemo } from "react";
import type { BoardContext } from "./board";
import { Board } from "./board";
import { lastReport, useNameOf } from "./conversation-names";
import { blockersLeft, deferredTask } from "./deferred-body";
import { Trunk } from "./dispatching";
import { placeInLine } from "./merge-place";
import { useEnding } from "./queued-ending";
import { type Quiet, quietText, useQuiet } from "./quiet";

/** What a row says of its agent: the full `text`, a short `label` for the line under its name. */
export interface RowStatus {
	text: string;
	label: string;
	urgent: boolean;
}

/** The status of a row, from what the page knows of its conversation and task. */
export function useRowStatus(row: Needing): RowStatus {
	const { conversation, task } = row;
	const nameOf = useNameOf();
	const trunk = useContext(Trunk);
	const board = useContext(Board);
	const { queued } = useEnding(conversation);
	const quiet = useQuiet(conversation);
	const name =
		conversation !== null ? nameOf(conversation) : (task?.task ?? "");
	const last = conversation === null ? null : lastReport(conversation);
	const deferral =
		last?.ending === "deferred" ? deferredTask(board.todos, last.task) : null;
	return statusOf(
		row,
		name,
		trunk,
		quiet,
		queued,
		deferral === null
			? null
			: {
					left: blockersLeft(deferral, board.todos, board.elsewhere),
					total: deferralBlockers(
						deferral,
						board.todos,
						board.elsewhere?.blockers[deferral.id],
					).length,
				},
	);
}

/**
 * The board as the sidebar and the inbox see it, which sit outside the
 * conversations page's own: the same, but knowing the tags of `tasks`, so
 * a row names them.
 */
export function useTaggedBoard(tasks: readonly Details[]): BoardContext {
	const board = useContext(Board);
	return useMemo(
		() => ({
			...board,
			taskTags: new Map(tasks.map((each) => [each.task, each.tags])),
		}),
		[board, tasks],
	);
}

/**
 * The tags of a row's task: the live task's, else what the board still
 * knows of the task its conversation ran in, else the tags the conversation
 * kept once that task was gone.
 */
export function useRowTags({
	conversation,
	task,
}: Needing): readonly string[] | undefined {
	const board = useContext(Board);
	const name = conversation?.task ?? conversation?.lastTask;
	return (
		task?.tags ??
		(name == null ? undefined : board.taskTags?.get(name)) ??
		conversation?.lastTags ??
		undefined
	);
}

/** The words before the first ` · `: "Ready to merge · alpha" is "Ready to merge". */
function shorten(text: string): string {
	return text.split(" · ")[0] ?? text;
}

/** What a row says under its name: what it waits on, does, or last did. */
export function statusOf(
	row: Needing,
	name: string,
	trunk: string | null,
	quiet: Quiet | null = null,
	queued = false,
	blockers: { left: number; total: number } | null = null,
): RowStatus {
	const { text, urgent } = fullStatus(
		row,
		name,
		trunk,
		quiet,
		queued,
		blockers,
	);
	// A working agent's text is its own subject, which a short label leaves out.
	const label =
		row.need.kind === "working" && text === row.need.subject
			? "Working"
			: shorten(text);
	return { text, label, urgent };
}

function fullStatus(
	{ conversation, task, need }: Needing,
	name: string,
	trunk: string | null,
	quiet: Quiet | null = null,
	// Its last card asked to queue its work, which the board has queued.
	queued = false,
	// How many blockers its deferred task still waits on, of all it named.
	blockers: { left: number; total: number } | null = null,
): { text: string; urgent: boolean } {
	if (need.kind === "working" && need.merge === "running") {
		return {
			text: `Merging onto ${task?.base ?? trunk ?? "trunk"}`,
			urgent: false,
		};
	}
	if (need.kind === "working" && need.merge === "queued") {
		// Its place in line, where the lock has told it: quiet, one phrase.
		const place =
			need.mergePlace === undefined ? "" : ` · ${placeInLine(need.mergePlace)}`;
		return { text: `Waiting to merge${place}`, urgent: false };
	}
	if (need.kind === "working" && need.evals === true) {
		return { text: "Running evals", urgent: false };
	}
	if (conversation?.heldForTask != null) {
		return { text: "Queued", urgent: false };
	}
	if (conversation?.status === "starting") {
		return {
			text: conversation.picking
				? "Auto pick is choosing the agent"
				: "Waiting for agent to start",
			urgent: false,
		};
	}
	if (quiet !== null && (need.kind === "working" || need.kind === "assuming")) {
		return { text: quietText(quiet), urgent: true };
	}
	if (need.kind === "waiting") {
		const open =
			need.why === "questions"
				? unanswered(need.questions, conversation?.messages ?? []).length
				: need.questions.length;
		const label =
			need.why === "ask"
				? "Asks to go on"
				: need.why === "review"
					? "Ready to merge"
					: need.why === "failed"
						? "Failed"
						: need.why === "orphaned"
							? "Orphaned"
							: open > 0
								? `${open} ${open === 1 ? "question" : "questions"}`
								: "Questions";
		// Named, when it waits for an agent this one handed out.
		const subject =
			need.via === undefined ? need.subject : `${need.via}: ${need.subject}`;
		return { text: `${label} · ${subject}`, urgent: true };
	}
	if (need.kind === "assuming") {
		const subject =
			need.via === undefined ? need.subject : `${need.via}: ${need.subject}`;
		return { text: `Working · ${subject}`, urgent: false };
	}
	if (need.kind === "working") {
		return { text: need.subject ?? "Working", urgent: false };
	}
	const report = conversation === null ? null : lastReport(conversation);
	if (report === null && queued) {
		return { text: "Queued", urgent: false };
	}
	if (report !== null) {
		const how = {
			merged: "Done",
			done: "Done",
			removed: "Removed",
			deferred:
				blockers !== null && blockers.left > 0
					? `Deferred · ${blockers.left} of ${blockers.total} left`
					: "Deferred",
			// From before escalating was retired.
			escalated: "Escalated",
			working: "Working",
		}[report.ending];
		return {
			text: report.reason === null ? how : `${how} · ${report.reason}`,
			urgent: false,
		};
	}
	if (conversation?.unread === true) {
		return { text: "New reply", urgent: false };
	}
	// What the agent called it, under the task it goes by.
	if (conversation?.title != null && conversation.title !== name) {
		return { text: conversation.title, urgent: false };
	}
	return {
		text: conversation?.task ?? task?.task ?? trunk ?? "main",
		urgent: false,
	};
}
