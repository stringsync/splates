import { type JSX, useState } from "react";
import { SplatesEvent } from "./splates-event";
import { Stamp } from "./stamp";
import type { WaitRequest } from "./wait-request";

/**
 * An agent's wait request as one event line, with a Show button that opens the
 * request as it stands: what it waits on, when it asked, and how it ended.
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
	const [shown, setShown] = useState(false);
	const subject =
		wait.type === "task"
			? ({ kind: "task", task: wait.task } as const)
			: `machine idle ${wait.duration}`;
	return (
		<div className="my-6">
			<SplatesEvent
				event={{
					words: [
						outcome === null ? "Waiting on" : "Finished waiting on",
						subject,
					],
					title: directive,
					act: { label: shown ? "Hide" : "Show", run: () => setShown(!shown) },
				}}
			/>
			{shown && (
				<dl
					data-slot="wait-card"
					className="mx-auto mt-2 grid max-w-xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border p-3 text-xs"
				>
					<dt className="text-muted-foreground">Waits on</dt>
					<dd>
						{wait.type === "task"
							? `Task ${wait.task} to merge or be removed`
							: `The machine to stay idle for ${wait.duration}`}
					</dd>
					{at !== null && (
						<>
							<dt className="text-muted-foreground">Asked</dt>
							<dd>
								<Stamp at={at} />
							</dd>
						</>
					)}
					<dt className="text-muted-foreground">Outcome</dt>
					<dd className="whitespace-pre-wrap">{outcome ?? "Still waiting"}</dd>
				</dl>
			)}
		</div>
	);
}
