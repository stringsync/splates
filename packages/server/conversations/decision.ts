/** What the person decided on a plan card: approve, approve with a review
 * before it merges, or request changes. */
export type PlanAction = "approve" | "review" | "revise";

/** The page's decision lines, newest wording first; `Approve & start` and
 * `Approve plan` are what cards sent before Approve and Approve & review. */
const DECISION =
	/^(Approve & review|Approve & start|Approve plan|Approve|Request changes)(?:: *([^\n]*))?(?:\nPlan from ([^\n]+))?(?:\n\n|$)/i;

/** The plan decision a message opens with, or null when it opens with none. */
export function planDecision(
	text: string,
): { action: PlanAction; title?: string; stamp?: string } | null {
	const decision = DECISION.exec(text.replace(/\r\n/g, "\n").trim());
	if (decision === null) {
		return null;
	}
	const [, said = "", title, stamp] = decision;
	const lower = said.toLowerCase();
	const action: PlanAction =
		lower === "request changes"
			? "revise"
			: lower === "approve & review"
				? "review"
				: "approve";
	return {
		action,
		...(title === undefined ? {} : { title }),
		...(stamp === undefined ? {} : { stamp }),
	};
}

/**
 * What a plan card's reply says past its decision lines (`Approve: <title>`
 * and `Plan from <stamp>`), which the card's own folded line already says:
 * "" for a bare decision, and null for a message that opens with none. A
 * decision typed with no title, as `Approve` alone, counts as none, so the
 * page still shows what the person typed by hand.
 */
export function afterDecision(text: string): string | null {
	const normalized = text.replace(/\r\n/g, "\n").trim();
	const decision = DECISION.exec(normalized);
	return decision === null || decision[2] === undefined
		? null
		: normalized.slice(decision[0].length).trim();
}
