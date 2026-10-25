import type { LaneRecord } from "@stringsync/splates-server/board";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import {
	nameOf,
	realName,
} from "@stringsync/splates-server/conversations/browser";
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
 * How the task ended, or that it escalated in a conversation from before
 * escalating was retired, when the conversation's last word is the agent's
 * report saying so. Anything the person says after it carries
 * the conversation on, and the report goes.
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

/**
 * Whether a report `reported` leaves the person to act: its task escalated,
 * from before escalating was retired.
 */
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
