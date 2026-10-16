import { createContext, use } from "react";
import { type Ending, type Report, stretches } from "../asked";
import { nameOf, realName } from "../conversation-name";
import type { ConversationState } from "../conversations";
import type { LaneRecord } from "../lanes";

/** Every lane there has been, to name a lane's orchestrator after it. */
export const Lanes = createContext<readonly LaneRecord[]>([]);

/** `nameOf` with the board's lanes, for a component to call. */
export function useNameOf(): (conversation: ConversationState) => string {
	const lanes = use(Lanes);
	return (conversation) => nameOf(conversation, lanes);
}

/** Whether `nameOf` is a stand-in, shown muted until a real name comes. */
export function unnamed(conversation: ConversationState): boolean {
	return realName(conversation, []) === null;
}

/**
 * How the task ended, or that it escalated, when the conversation's last word
 * is the agent's report saying so. Anything the person says after it carries
 * the conversation on, and the report goes. An escalation by one handed its
 * task is left out: the one that handed it out relays it, and waits on the
 * person for it in its place.
 */
export function reportedAs(conversation: ConversationState): Ending | null {
	const ending = lastReport(conversation)?.ending ?? null;
	return conversation.handedBy !== null && waitsOn(ending) ? null : ending;
}

/**
 * Whether the conversation's work is done, as `reportedAs` reads it: its task
 * merged, and maybe investigated since, or handed off to another agent, or
 * the lanes it orchestrated are finished.
 */
export function reportsDone(conversation: ConversationState): boolean {
	const reported = reportedAs(conversation);
	return (
		reported === "merged" ||
		reported === "investigated" ||
		reported === "handed" ||
		reported === "finished"
	);
}

/**
 * Whether a report `reported` leaves the person to act: its task escalated,
 * or the lanes it orchestrates wait on a task that did.
 */
export function waitsOn(reported: Ending | null): boolean {
	return reported === "escalated" || reported === "waiting";
}

/** The report that is the conversation's last word, as for `reportedAs`. */
export function lastReport(conversation: ConversationState): Report | null {
	const last = conversation.messages.at(-1);
	if (last === undefined || last.role !== "agent") {
		return null;
	}
	const reply = last.parts.findLast(
		(part) => part.type === "text" && part.text.trim() !== "",
	);
	const report =
		reply?.type === "text"
			? stretches(reply.text).findLast((each) => each.type === "report")
			: undefined;
	return report?.type === "report" ? report.report : null;
}
