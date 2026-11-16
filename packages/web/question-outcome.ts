import type { Proposal, TaskReport } from "@splates/server/plans";
import { APPROVE, directive } from "@splates/server/plans/browser";
import type { Words } from "./splates-event";

/**
 * What the line of questions no longer asking says: how many were asked, as a
 * reply need not answer them, or whether the proposal they rest under was
 * approved, and the task an escalation named. `sent` is null when they were
 * asked again below.
 */
export function questionOutcome(
	questions: number,
	escalation: TaskReport | null,
	proposal: Proposal | null,
	sent: string | null,
): Words {
	const said =
		proposal === null || sent === null
			? `Asked ${questions} ${questions === 1 ? "question" : "questions"}`
			: directive(sent) === APPROVE
				? "Proposal approved"
				: "Proposal answered";
	return escalation === null
		? [said]
		: [said, { kind: "task", task: escalation.task }];
}

/** What a phone's Send says when nothing was written. */
const NOTHING = "Nothing to add.";

/** What a send says: approving, with what was written beside it. */
export function replyText(approving: boolean, text: string): string {
	if (!approving) {
		return text === "" ? NOTHING : text;
	}
	return text === "" ? APPROVE : `${APPROVE}\n\n${text}`;
}
