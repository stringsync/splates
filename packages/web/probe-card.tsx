import { makeAssistantDataUI } from "@assistant-ui/react";
import type { SignalProbe } from "@splates/server/signals";
import {
	BanIcon,
	CheckIcon,
	CircleCheckIcon,
	CircleSlashIcon,
	RadarIcon,
	RefreshCwIcon,
	TimerOffIcon,
	UnplugIcon,
} from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { CardBody, CardShell, type Tone } from "./card-shell";
import { stopSignalProbe } from "./conversation-api";
import { useNow } from "./hooks/use-now";
import { PendingSpinner, useShowPending } from "./pending";
import { ProbeChecks, ScriptToggle } from "./probe-checks";
import { Refusal, useRefusal } from "./refusal";
import { ProbeCards, SignalWaits } from "./signal-contexts";
import { overlaps, probeId, timeLeft } from "./signal-of";

export { ProbeCards } from "./signal-contexts";

/** Renders a `data-probe` part: the one card of a probe, which follows it to its end. */
export const ProbeUI = makeAssistantDataUI<{ id: string }>({
	name: "probe",
	render: ({ data }) => <ProbeLine id={data.id} />,
});

/**
 * One signal probe as one card, which follows it to its end: what it checks
 * for, a strip of its latest runs, its last output and its script folded
 * away, with Stop polling while it is on.
 */
export function ProbeCard({ probe }: { probe: SignalProbe }): JSX.Element {
	const { Icon, tone, header } = LOOK[probe.state];
	const on = probe.state === "idle" || probe.state === "running";
	const now = useNow(on);
	const { refusal, attempt } = useRefusal();
	const [busy, setBusy] = useState(false);
	const showBusy = useShowPending(busy);
	const stop = (): void => {
		setBusy(true);
		void attempt(
			stopSignalProbe(probe.name).finally(() => setBusy(false)),
			"Not stopped",
		);
	};
	return (
		<CardShell
			label={`poll script ${probe.name}`}
			Icon={Icon}
			title={header(probe.name)}
			tone={tone}
			ringed={false}
			aside={
				<span className="text-muted-foreground text-xs">
					{on
						? `stops in ${timeLeft(probe.deadline, now)}`
						: `after ${probe.count} run${probe.count === 1 ? "" : "s"}`}
				</span>
			}
		>
			<CardBody text={probe.description} />
			<ProbeChecks probe={probe} now={now} />
			<div className="border-border/60 border-t px-4 py-2.5 @max-md:px-3">
				<ScriptToggle script={probe.script}>
					{on ? (
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={stop}
							className="gap-1.5 in-data-sheet:h-11 in-data-sheet:text-base"
						>
							{busy && showBusy ? (
								<PendingSpinner shown />
							) : (
								<BanIcon data-icon="inline-start" />
							)}
							Stop polling
						</Button>
					) : (
						<span className="flex items-center gap-1 text-xs">
							{probe.state === "raised" ? (
								<CheckIcon className="size-3.5 text-success" strokeWidth={3} />
							) : (
								<BanIcon className="size-3.5" />
							)}
							{ENDED[probe.state]}
						</span>
					)}
				</ScriptToggle>
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}

const LOOK: Record<
	SignalProbe["state"],
	{ Icon: typeof RadarIcon; tone: Tone; header: (name: string) => string }
> = {
	idle: {
		Icon: RadarIcon,
		tone: "info",
		header: (name) => `Poll script ready on ${name}`,
	},
	running: {
		Icon: RadarIcon,
		tone: "info",
		header: (name) => `Probing ${name}`,
	},
	raised: {
		Icon: CircleCheckIcon,
		tone: "success",
		header: (name) => `Poll script fired ${name}`,
	},
	"timed out": {
		Icon: TimerOffIcon,
		tone: "warning",
		header: (name) => `Poll script on ${name} timed out`,
	},
	orphaned: {
		Icon: UnplugIcon,
		tone: "neutral",
		header: (name) => `Poll script on ${name} stopped: nothing waits on it`,
	},
	stopped: {
		Icon: CircleSlashIcon,
		tone: "neutral",
		header: (name) => `Poll script on ${name} stopped`,
	},
	replaced: {
		Icon: RefreshCwIcon,
		tone: "neutral",
		header: (name) => `Poll script on ${name} replaced`,
	},
};

const ENDED: Partial<Record<SignalProbe["state"], string>> = {
	raised: "Fired, poll script stopped",
	"timed out": "Timed out",
	orphaned: "Stopped: its last wait ended",
	stopped: "Stopped",
	replaced: "Replaced by a newer poll script",
};

function ProbeLine({ id }: { id: string }): JSX.Element | null {
	const probes = useContext(ProbeCards);
	const { waits } = useContext(SignalWaits);
	const probe = probes.find(
		(each) => probeId(each.name, each.startedAt) === id,
	);
	// A wait on its signal draws it on its own card instead.
	if (probe === undefined || waits.some((wait) => overlaps(probe, wait))) {
		return null;
	}
	return <ProbeCard probe={probe} />;
}
