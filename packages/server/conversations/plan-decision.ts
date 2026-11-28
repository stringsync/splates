import { fail } from "../exit";
import {
	MERGE,
	type PlanCard,
	planHasInvasiveTag,
	planHasOneWayTag,
	stretches,
} from "../plans";
import { planDecision } from "./decision";
import type { ConversationState, Message } from "./state";

export { type PlanAction, planDecision } from "./decision";

/** Why a conversation holds its merge for review: Approve & review, a One-way plan, or an Invasive plan. */
export type ReviewHold = "review" | "one-way" | "invasive";

/** Refuses the person's decision on a plan that is no longer the latest. A
 * card includes its title and timestamp so a reply from another tab cannot
 * approve a revision the person has yet to see. */
export function refuseStalePlanDecision(
	text: string,
	state: ConversationState,
): void {
	const decision = planDecision(text);
	if (decision === null) {
		return;
	}
	const { title, stamp } = decision;
	const last = state.messages.at(-1);
	const words =
		last?.role === "agent"
			? last.parts.findLast(
					(part) => part.type === "text" && part.text.trim() !== "",
				)
			: null;
	const plan =
		words?.type === "text"
			? stretches(words.text).findLast((part) => part.type === "plan")
			: undefined;
	if (
		title !== undefined &&
		(plan?.plan.title !== title ||
			(stamp !== undefined && stamp !== (last?.until ?? last?.at)))
	) {
		fail("usage", "This plan is no longer pending. Open the latest plan.");
	}
}

/**
 * Whether the person approved the conversation's latest Plan card: the
 * page's Approve or Approve & review, or a merge review's approval, said
 * by the person after the agent last posted a plan. A plan posted after an
 * approval is a new design and needs its own.
 */
export function planApproved(
	state: Pick<ConversationState, "messages">,
): boolean {
	const planned = state.messages.findLastIndex(
		(message) => message.role === "agent" && postsPlan(message),
	);
	return (
		planned !== -1 &&
		state.messages.slice(planned + 1).some((message) => approves(message))
	);
}

/** Whether `message` posts a Plan card. */
export function postsPlan(message: Message): boolean {
	return latestPlan(message) !== null;
}

function latestPlan(message: Message): PlanCard | null {
	for (let i = message.parts.length - 1; i >= 0; i -= 1) {
		const part = message.parts[i];
		if (part?.type !== "text") {
			continue;
		}
		const found = stretches(part.text).findLast((each) => each.type === "plan");
		if (found !== undefined) {
			return found.plan;
		}
	}
	return null;
}

/**
 * Why a conversation holds its task from merging until a merge review is
 * approved (`[SPLATES MERGE]`): either the latest approval was Approve &
 * review, or the latest plan carries the One-way or Invasive tag and no merge
 * review approval has come since. Null when none holds.
 */
export function reviewHold(
	state: Pick<ConversationState, "messages">,
): ReviewHold | null {
	const last = state.messages.findLast((message) => approves(message));
	if (
		last !== undefined &&
		!said(last).includes(MERGE) &&
		planDecision(said(last))?.action === "review"
	) {
		return "review";
	}
	const planned = state.messages.findLastIndex(
		(message) => message.role === "agent" && postsPlan(message),
	);
	if (planned === -1) {
		return null;
	}
	const plan = latestPlan(state.messages[planned] as Message);
	if (plan === null) {
		return null;
	}
	const hold = planHasOneWayTag(plan.body)
		? "one-way"
		: planHasInvasiveTag(plan.body)
			? "invasive"
			: null;
	if (hold === null) {
		return null;
	}
	const reviewed = state.messages
		.slice(planned + 1)
		.some((message) => approvesMerge(message));
	return reviewed ? null : hold;
}

/**
 * Whether a conversation holds its task from merging until the person
 * approves a merge review (`[SPLATES MERGE]`).
 */
export function reviewPending(
	state: Pick<ConversationState, "messages">,
): boolean {
	return reviewHold(state) !== null;
}

/** Whether a message is the person's own merge review approval (`[SPLATES MERGE]`). */
function approvesMerge(message: Message): boolean {
	return (
		message.role === "user" &&
		message.told === undefined &&
		said(message).includes(MERGE)
	);
}

/** The person's own approval: never one another agent, the queue or the server said. */
function approves(message: Message): boolean {
	if (message.role !== "user" || message.told !== undefined) {
		return false;
	}
	const text = said(message);
	const action = planDecision(text)?.action;
	return action === "approve" || action === "review" || text.includes(MERGE);
}

function said(message: Message): string {
	return message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("\n")
		.replace(/\r\n/g, "\n")
		.trim();
}
