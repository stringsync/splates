import { cleared, deferralBlockers } from "@splates/server/board/browser";
import type { ConversationState } from "@splates/server/conversations";
import type { TaskReport } from "@splates/server/plans/browser";
import { stretches } from "@splates/server/plans/browser";
import { type JSX, useContext } from "react";
import { Board } from "./board";
import { CardShell, ENDINGS } from "./card-shell";
import { DeferredBody, deferredTask } from "./deferred-body";

/**
 * The Blocked report of `conversation` that the person wrote past while its
 * task still waits, whose card folds where it was said and shows again at the
 * bottom; null when it is the last message, or none is blocked.
 */
export function blockedReport(
	conversation: Pick<ConversationState, "messages">,
): TaskReport | null {
	const { messages } = conversation;
	const at = messages.findLastIndex((message) =>
		message.parts.some(
			(part) =>
				part.type === "text" &&
				stretches(part.text).some(
					(each) => each.type === "report" && each.report.ending === "deferred",
				),
		),
	);
	if (
		at === -1 ||
		!messages.slice(at + 1).some((message) => message.role === "user")
	) {
		return null;
	}
	for (const part of messages[at]?.parts.toReversed() ?? []) {
		if (part.type !== "text") {
			continue;
		}
		const report = stretches(part.text).findLast(
			(each) => each.type === "report" && each.report.ending === "deferred",
		);
		if (report?.type === "report") {
			return report.report;
		}
	}
	return null;
}

/**
 * Pinned above the composer: the live Blocked card of a conversation that
 * went on past its report while a task it waits on is still open.
 */
export function BlockedPanel({
	conversation,
}: {
	conversation: ConversationState;
}): JSX.Element | null {
	const board = useContext(Board);
	const report = blockedReport(conversation);
	const task = report === null ? null : deferredTask(board.todos, report.task);
	if (report === null || task === null || task.takenBy !== null) {
		return null;
	}
	const open = deferralBlockers(
		task,
		board.todos,
		board.elsewhere?.blockers[task.id],
	).filter((each) => each.kind === "task" && !cleared(each));
	if (open.length === 0) {
		return null;
	}
	const { Icon, tone, title } = ENDINGS.deferred;
	return (
		<div className="px-2">
			<CardShell
				label={`blocked ${report.task}`}
				Icon={Icon}
				title={title}
				tone={tone}
				task={report.task}
			>
				<DeferredBody task={task} />
			</CardShell>
		</div>
	);
}
