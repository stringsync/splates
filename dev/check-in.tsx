import { createContext, type JSX, useContext } from "react";
import { Duration } from "webappwiz/time";
import type { ConversationState } from "../conversation-state";
import { CHECK_IN } from "../prompts";
import { useCardReply } from "./card-reply";
import { ThreadAction } from "./thread-action";

/** How long an agent works before the page offers to check in on it. */
export const CHECK_IN_AFTER = Duration.mins(10);

/**
 * Whether the agent is at work and would hear a check-in next: not starting
 * up under a turn that is over, not waiting on the person to answer what it
 * asks, and with no message waiting above the composer, which it would hear
 * first. The thread offers none otherwise.
 */
export const Hearing = createContext(false);

/** What `Hearing` holds for `conversation`. */
export function hears(conversation: ConversationState): boolean {
	return (
		conversation.status === "running" &&
		conversation.ask === null &&
		!conversation.messages.some((each) => each.queued)
	);
}

/**
 * Under the line of work begun at `since`, once it has gone on
 * `CHECK_IN_AFTER` by `now`, a button asking the agent where the work stands
 * with `CHECK_IN`: outlined where Reconnect is filled, since checking in is
 * optional. There while the agent works and the person has sent nothing
 * since, queued or not.
 */
export function CheckIn({
	since,
	now,
}: {
	since: string;
	now: number;
}): JSX.Element | null {
	const { reply, sent } = useCardReply();
	const hearing = useContext(Hearing);
	if (
		now - Date.parse(since) < CHECK_IN_AFTER.ms ||
		sent !== null ||
		!hearing ||
		reply?.send == null
	) {
		return null;
	}
	return (
		<ThreadAction
			outline
			title={CHECK_IN}
			onClick={() => void reply.send?.(CHECK_IN)}
		>
			Check in
		</ThreadAction>
	);
}
