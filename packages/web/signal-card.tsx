import { makeAssistantDataUI } from "@assistant-ui/react";
import type { SignalWait } from "@splates/server/signals";
import {
	BanIcon,
	CheckIcon,
	CircleCheckIcon,
	CircleSlashIcon,
	RadioIcon,
	TimerOffIcon,
} from "lucide-react";
import { createContext, type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { CardBody, CardShell, type Tone } from "./card-shell";
import { stopSignalWait } from "./conversation-api";
import { useNow } from "./hooks/use-now";
import { PendingSpinner, useShowPending } from "./pending";
import { Refusal, useRefusal } from "./refusal";
import { timeLeft, waitOf } from "./signal-of";

/** The conversation's id and signal waits, so `SignalUI` can draw each in the thread. */
export const SignalWaits = createContext<{
	conversation: string | null;
	waits: readonly SignalWait[];
}>({ conversation: null, waits: [] });

/** Renders a `data-signal` part: the one card of a wait, which follows it to its end. */
export const SignalUI = makeAssistantDataUI<{ id: string }>({
	name: "signal",
	render: ({ data }) => <SignalLine id={data.id} />,
});

const LOOK: Record<
	SignalWait["state"],
	{ Icon: typeof RadioIcon; tone: Tone; header: (name: string) => string }
> = {
	waiting: {
		Icon: RadioIcon,
		tone: "info",
		header: (name) => `Waiting on ${name}`,
	},
	raised: {
		Icon: CircleCheckIcon,
		tone: "success",
		header: (name) => `${name} raised`,
	},
	"timed out": {
		Icon: TimerOffIcon,
		tone: "warning",
		header: (name) => `${name} timed out`,
	},
	stopped: {
		Icon: CircleSlashIcon,
		tone: "neutral",
		header: (name) => `Stopped waiting on ${name}`,
	},
};

/**
 * One signal wait as one card, which follows it to its end. The header says
 * its state, the body says what the agent waits for, and the foot offers Stop
 * waiting while it waits, then says how it ended.
 */
export function SignalCard({
	wait,
	conversation,
}: {
	wait: SignalWait;
	conversation: string | null;
}): JSX.Element {
	const { Icon, tone, header } = LOOK[wait.state];
	const waiting = wait.state === "waiting";
	const now = useNow(waiting);
	const { refusal, attempt } = useRefusal();
	const [busy, setBusy] = useState(false);
	const showBusy = useShowPending(busy);
	const stop = (): void => {
		if (conversation === null) {
			return;
		}
		setBusy(true);
		void attempt(
			stopSignalWait(conversation, wait.id).finally(() => setBusy(false)),
			"Not stopped",
		);
	};
	const meta = waiting
		? wait.since === null
			? null
			: `Accepts raises since ${new Date(wait.since).toLocaleString()}`
		: wait.state === "raised" && wait.raise !== undefined
			? `Raised by ${wait.raise.by}, ${new Date(wait.raise.at).toLocaleTimeString()}`
			: wait.state === "timed out"
				? "Nothing was raised before its timeout"
				: "Stopped before anything was raised";
	const payload = wait.raise?.payload ?? null;
	return (
		<CardShell
			label={`signal ${wait.name}`}
			Icon={Icon}
			title={header(wait.name)}
			tone={tone}
			ringed={false}
			aside={
				waiting ? (
					<span className="text-muted-foreground text-xs">
						times out in {timeLeft(wait.deadline, now)}
					</span>
				) : undefined
			}
		>
			<CardBody text={wait.description} />
			{meta !== null && (
				<p className="px-4 pb-3 text-muted-foreground text-xs">{meta}</p>
			)}
			{payload !== null && (
				<pre className="mx-4 mb-3 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
					{JSON.stringify(payload, null, 2)}
				</pre>
			)}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5">
				{waiting ? (
					<Button
						size="sm"
						variant="outline"
						disabled={conversation === null || busy}
						onClick={stop}
						className="gap-1.5 in-data-sheet:h-11 in-data-sheet:text-base"
					>
						{busy && showBusy ? (
							<PendingSpinner shown />
						) : (
							<BanIcon data-icon="inline-start" />
						)}
						Stop waiting
					</Button>
				) : (
					<span className="flex items-center gap-1 text-xs">
						{wait.state === "raised" ? (
							<CheckIcon className="size-3.5 text-success" strokeWidth={3} />
						) : wait.state === "timed out" ? (
							<TimerOffIcon className="size-3.5" />
						) : (
							<BanIcon className="size-3.5" />
						)}
						{wait.state === "raised"
							? "Raised"
							: wait.state === "timed out"
								? "Timed out"
								: "Stopped"}
					</span>
				)}
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}

function SignalLine({ id }: { id: string }): JSX.Element | null {
	const { conversation, waits } = useContext(SignalWaits);
	const wait = waits.find((each) => each.id === waitOf(id));
	if (wait === undefined) {
		return null;
	}
	return <SignalCard wait={wait} conversation={conversation} />;
}
