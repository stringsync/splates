import type { Proposal, TaskReport } from "@stringsync/splates-server/plans";
import { APPROVE, directive } from "@stringsync/splates-server/plans/browser";
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
