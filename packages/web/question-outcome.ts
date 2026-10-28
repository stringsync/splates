import type { Proposal, TaskReport } from "@stringsync/splates-server/plans";
import { APPROVE, directive } from "@stringsync/splates-server/plans/browser";
import type { SplatesEventView, Words } from "./splates-event";

/** Summarizes answered questions or a proposal, with its subject reopening the card. */
export function questionOutcome(
	questions: { count: number; escalation: TaskReport | null },
	proposal: Proposal | null,
	sent: string | null,
	open: () => void,
	expanded: boolean,
): SplatesEventView {
	const { count, escalation } = questions;
	const asked = proposal === null || sent === null;
	const said = asked
		? `Asked ${count} ${count === 1 ? "question" : "questions"}`
		: directive(sent ?? "") === APPROVE
			? "Proposal approved"
			: "Proposal answered";
	const mobile: Words =
		escalation === null
			? [said]
			: [said, { kind: "task", task: escalation.task }];
	return {
		words: [
			asked
				? "Asked"
				: directive(sent ?? "") === APPROVE
					? "Approved"
					: "Answered",
		],
		mobile: {
			words: mobile,
			act: { label: expanded ? "Hide" : "Show", run: open },
		},
		act: {
			label: asked
				? `${count} ${count === 1 ? "question" : "questions"}`
				: "Proposal",
			run: open,
			expanded,
		},
	};
}
