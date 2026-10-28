import type { Proposal } from "@stringsync/splates-server/plans";
import { APPROVE, directive } from "@stringsync/splates-server/plans/browser";
import type { SplatesEventView } from "./splates-event";

/** Summarizes answered questions or a proposal, with its subject reopening the card. */
export function questionOutcome(
	questions: number,
	proposal: Proposal | null,
	sent: string | null,
	open: () => void,
	expanded: boolean,
): SplatesEventView {
	const asked = proposal === null || sent === null;
	return {
		words: [
			asked
				? "Asked"
				: directive(sent ?? "") === APPROVE
					? "Approved"
					: "Answered",
		],
		act: {
			label: asked
				? `${questions} ${questions === 1 ? "question" : "questions"}`
				: "Proposal",
			run: open,
			expanded,
		},
	};
}
