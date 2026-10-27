import type { LaneRecord } from "@stringsync/splates-server/board";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import {
	nameOf,
	realName,
} from "@stringsync/splates-server/conversations/browser";
import type { PermissionProposal } from "@stringsync/splates-server/plans";
import {
	type Ending,
	stretches,
	type TaskReport,
} from "@stringsync/splates-server/plans/browser";
import { createContext, use } from "react";

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
 * How the conversation's task ended, when its last word is the agent's
 * report saying so; null once the person says anything after it, which
 * carries the conversation on.
 */
export function reportedAs(conversation: ConversationState): Ending | null {
	return lastReport(conversation)?.ending ?? null;
}

/**
 * Whether the conversation's work is done, as `reportedAs` reads it: its
 * task merged, or it reported its work done.
 */
export function reportsDone(conversation: ConversationState): boolean {
	const reported = reportedAs(conversation);
	return reported === "merged" || reported === "done";
}

/** Whether the report `reported` leaves the person to act on it. */
export function waitsOn(reported: Ending | null): boolean {
	return reported === "escalated";
}

/** The report that is the conversation's last word, as for `reportedAs`. */
export function lastReport(conversation: ConversationState): TaskReport | null {
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

/**
 * The card of the conversation's own tasks or lane that is its last word,
 * asking the person to queue them; null when it ends on anything else.
 */
export function queueAsked(
	conversation: ConversationState,
): PermissionProposal | null {
	const last = conversation.messages.at(-1);
	if (last === undefined || last.role !== "agent") {
		return null;
	}
	const reply = last.parts.findLast(
		(part) => part.type === "text" && part.text.trim() !== "",
	);
	// Most replies are no card, and parsing them each render adds up.
	const final =
		reply?.type === "text" && reply.text.includes("Permission:")
			? stretches(reply.text).at(-1)
			: undefined;
	return final?.type === "permission" &&
		final.permission.action === "queue" &&
		final.permission.project === undefined
		? final.permission
		: null;
}
