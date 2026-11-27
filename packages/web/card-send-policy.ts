import type { PlanChoice } from "./plan-decision";

/**
 * Computes the unified send and approval policy for a question or plan card.
 * Both the desktop footer and the mobile sheet render from this result, and
 * the submit handler enforces the same gate.
 */
export function cardSendPolicy({
	live,
	pending,
	decidePlan,
	decision,
	unansweredPlan,
	empty,
	taking,
	answering,
}: CardSendInput): CardSendPolicy {
	const canApprove = !unansweredPlan;
	const undecided =
		decidePlan &&
		(decision === null || (decision !== "revise" && unansweredPlan));
	const canSubmit = live && !pending && !(decidePlan ? undecided : empty);
	// A dictation take in progress keeps Send enabled on ordinary question cards
	// so pressing Send finishes the take and submits the words, but never
	// bypasses a missing plan decision.
	const canSend =
		live && !pending && !(decidePlan ? undecided : empty && !taking);
	return {
		canApprove,
		undecided,
		canSubmit,
		canSend,
		disabled: !canSend,
		pending,
		label: answering ? "Answer" : "Send",
	};
}

/**
 * Toggles a single-choice decision: clicking the already-picked option undoes
 * it back to null, matching how ordinary question choices behave.
 */
export function toggleDecision<T>(current: T | null, picked: T): T | null {
	return current === picked ? null : picked;
}

/**
 * Inputs the shared card send policy reads to decide whether a question or
 * plan card can send, what its button says, and whether approval is allowed.
 */
export interface CardSendInput {
	/** Whether the card can still be answered. */
	live: boolean;
	/** Whether a send is already in flight. */
	pending: boolean;
	/** Whether the card carries its own plan decision panel. */
	decidePlan: boolean;
	/** The picked plan decision, or null while none is picked. */
	decision: PlanChoice | null;
	/** Whether any question on the plan card is still unanswered. */
	unansweredPlan: boolean;
	/** Whether the reply has no answers, note, or attached files. */
	empty: boolean;
	/** Whether dictation is currently taking into one of the card's boxes. */
	taking: boolean;
	/** Whether the card answers an agent form rather than sending a reply. */
	answering: boolean;
}

/**
 * The single send and approval policy shared by desktop cards, mobile sheets,
 * and the submit handler so their disabled rules and labels never diverge.
 */
export interface CardSendPolicy {
	/** Whether approval choices are enabled (all plan questions answered). */
	canApprove: boolean;
	/** Whether a plan card still needs a valid decision before sending. */
	undecided: boolean;
	/** Whether submitting right now can send a message. */
	canSubmit: boolean;
	/** Whether the Send button (or Mod+Enter) is enabled. */
	canSend: boolean;
	/** Whether the Send button is disabled. */
	disabled: boolean;
	/** Whether a send is already in flight. */
	pending: boolean;
	/** What the Send button reads. */
	label: "Answer" | "Send";
}
