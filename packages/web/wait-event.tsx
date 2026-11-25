import type { JSX } from "react";
import { SplatesEvent } from "./splates-event";
import type { WaitRequest } from "./wait-request";

/**
 * An agent's wait request as one event line in the thread: what it waits on,
 * and once over, that it finished, the server's word on how in its tooltip.
 * While it runs, `AgentWaitBar` above the composer says so too.
 */
export function WaitEvent({
	directive,
	wait,
	at,
	outcome,
}: {
	directive: string;
	wait: WaitRequest;
	/** When the agent asked, as an ISO time, if known. */
	at: string | null;
	/** What the server reported when the wait ended; null while it runs. */
	outcome: string | null;
}): JSX.Element {
	const subject =
		wait.type === "task"
			? ({ kind: "task", task: wait.task } as const)
			: `machine idle ${wait.duration}`;
	return (
		<SplatesEvent
			event={{
				words: [
					outcome === null ? "Waiting on" : "Finished waiting on",
					subject,
				],
				at,
				title: outcome === null ? directive : `${directive}\n${outcome}`,
			}}
		/>
	);
}
