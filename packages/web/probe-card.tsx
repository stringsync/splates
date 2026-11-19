import { makeAssistantDataUI } from "@assistant-ui/react";
import type { ProbeRun, SignalProbe } from "@splates/server/signals";
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
import { createContext, type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { CardBody, CardShell, type Tone } from "./card-shell";
import { stopSignalProbe } from "./conversation-api";
import { useNow } from "./hooks/use-now";
import { PendingSpinner, useShowPending } from "./pending";
import { Refusal, useRefusal } from "./refusal";
import { ago, everyOf, probeId, timeLeft } from "./signal-of";

/** The signal probes a conversation started, so `ProbeUI` can draw each in the thread. */
export const ProbeCards = createContext<readonly SignalProbe[]>([]);

/** Renders a `data-probe` part: the one card of a probe, which follows it to its end. */
export const ProbeUI = makeAssistantDataUI<{ id: string }>({
	name: "probe",
	render: ({ data }) => <ProbeLine id={data.id} />,
});

/**
 * One signal probe as one card, which follows it to its end: what it checks
 * for, a strip of its latest runs, its last output and its script folded
 * away, with Stop probe while it is on.
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
	const lastRun = probe.runs.at(-1);
	const status =
		probe.state === "idle"
			? "runs once a wait begins"
			: probe.passed === null
				? "not run yet"
				: probe.passed
					? "passing"
					: "failing";
	return (
		<CardShell
			label={`probe ${probe.name}`}
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
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-2 text-muted-foreground text-xs">
				<span>Runs, every {everyOf(probe.everyMs)}:</span>
				<RunStrip runs={probe.runs} />
				<span>
					{status}
					{lastRun !== undefined && ` · last ${ago(lastRun.at, now)}`}
					{on &&
						probe.next !== undefined &&
						` · next in ${timeLeft(probe.next, now)}`}
				</span>
			</div>
			{lastRun !== undefined && lastRun.output !== "" && (
				<p className="truncate px-4 pb-2 text-muted-foreground text-xs">
					Last output:{" "}
					<span className="font-mono">{lastRun.output.split("\n").at(-1)}</span>
				</p>
			)}
			<details className="px-4 pb-3 text-xs">
				<summary className="cursor-pointer text-muted-foreground">
					Script
				</summary>
				<pre className="mt-1.5 overflow-x-auto rounded bg-muted px-3 py-2 font-mono">
					{probe.script}
				</pre>
			</details>
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5">
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
						Stop probe
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
		header: (name) => `Probe ready on ${name}`,
	},
	running: {
		Icon: RadarIcon,
		tone: "info",
		header: (name) => `Probing ${name}`,
	},
	raised: {
		Icon: CircleCheckIcon,
		tone: "success",
		header: (name) => `Probe raised ${name}`,
	},
	"timed out": {
		Icon: TimerOffIcon,
		tone: "warning",
		header: (name) => `Probe on ${name} timed out`,
	},
	orphaned: {
		Icon: UnplugIcon,
		tone: "neutral",
		header: (name) => `Probe on ${name} stopped: nothing waits on it`,
	},
	stopped: {
		Icon: CircleSlashIcon,
		tone: "neutral",
		header: (name) => `Probe on ${name} stopped`,
	},
	replaced: {
		Icon: RefreshCwIcon,
		tone: "neutral",
		header: (name) => `Probe on ${name} replaced`,
	},
};

const ENDED: Partial<Record<SignalProbe["state"], string>> = {
	raised: "Raised, probe stopped",
	"timed out": "Timed out",
	orphaned: "Stopped: its last wait ended",
	stopped: "Stopped",
	replaced: "Replaced by a newer probe",
};

/** One square per run, oldest first: filled for a pass. */
function RunStrip({ runs }: { runs: readonly ProbeRun[] }): JSX.Element {
	return (
		<ul className="flex items-center gap-1" aria-label="runs">
			{runs.map((run) => (
				<li
					key={run.at}
					title={`${new Date(run.at).toLocaleTimeString()}: exit ${run.exit}`}
					aria-label={run.exit === 0 ? "passed" : "failed"}
					className={cn(
						"size-2.5 rounded-[2px]",
						run.exit === 0 ? "bg-success" : "bg-muted-foreground/30",
					)}
				/>
			))}
		</ul>
	);
}

function ProbeLine({ id }: { id: string }): JSX.Element | null {
	const probes = useContext(ProbeCards);
	const probe = probes.find(
		(each) => probeId(each.name, each.startedAt) === id,
	);
	if (probe === undefined) {
		return null;
	}
	return <ProbeCard probe={probe} />;
}
