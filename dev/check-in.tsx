import { createContext, type JSX, useContext } from "react";
import { Duration } from "webappwiz/time";
import { CHECK_IN } from "../prompts";
import { useCardReply } from "./card-reply";
import { ThreadAction } from "./thread-action";

/** How long an agent works before the page offers to check in on it. */
export const CHECK_IN_AFTER = Duration.mins(10);

/**
 * Whether a message waits for the agent above the composer, which it hears
 * before any check-in, so the thread offers none meanwhile.
 */
export const Queueing = createContext(false);

/**
 * Under the line of work begun at `since`, once it has gone on
 * `CHECK_IN_AFTER` by `now`, a button asking the agent where the work stands
 * with `CHECK_IN`: outlined where Resume is filled, since checking in is
 * optional. There while the person has sent nothing since, queued or not.
 */
export function CheckIn({
	since,
	now,
}: {
	since: string;
	now: number;
}): JSX.Element | null {
	const { reply, sent } = useCardReply();
	const queueing = useContext(Queueing);
	if (
		now - Date.parse(since) < CHECK_IN_AFTER.ms ||
		sent !== null ||
		queueing ||
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
