import type { ProbeRun, SignalProbe } from "@splates/server/signals";
import { ChevronRightIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { cn } from "#web/lib/utils.ts";
import { ago, errored, errorsInARow, everyOf, timeLeft } from "./signal-of";

/** A probe's checks on a card: how often, the dots, what they say, and the last check's output. */
export function ProbeChecks({
	probe,
	now,
}: {
	probe: SignalProbe;
	now: number;
}): JSX.Element {
	const on = probeOn(probe);
	const last = probe.runs.at(-1);
	const broke = last !== undefined && errored(last);
	return (
		<div className="px-4 pb-3">
			<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted-foreground text-xs">
				<span>
					{on ? "Checking" : "Checked"} every {everyOf(probe.everyMs)}
				</span>
				{probe.runs.length > 0 && (
					<CheckDots runs={probe.runs} next={probe.state === "running"} />
				)}
				<span>{checkStatus(probe, now)}</span>
			</div>
			{last !== undefined && last.output !== "" && (
				<div className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs">
					<span className="block text-[11px] text-muted-foreground">
						Last check · {ago(last.at, now)}
						{broke && ` · exit ${last.exit}`}
					</span>
					<pre
						className={cn(
							"max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono",
							broke && "text-destructive",
						)}
					>
						{last.output}
					</pre>
				</div>
			)}
		</div>
	);
}

/** How many of a probe's latest runs its dots show. */
const SHOWN = 8;

/** Whether a probe still runs, or will once a wait begins. */
export function probeOn(probe: SignalProbe): boolean {
	return probe.state === "idle" || probe.state === "running";
}

/** Whether a probe's latest run errored while it is on, so its card warns. */
export function probeBroken(probe: SignalProbe): boolean {
	return probeOn(probe) && errorsInARow(probe.runs) > 0;
}

const ENDED: Partial<Record<SignalProbe["state"], string>> = {
	raised: "the check passed",
	"timed out": "checks timed out",
	orphaned: "checks stopped",
	stopped: "checks stopped",
	replaced: "replaced by a newer check",
};

/** What a probe's checks say now, in a few words. */
export function checkStatus(probe: SignalProbe, now: number): string {
	if (!probeOn(probe)) {
		return ENDED[probe.state] ?? "checks stopped";
	}
	if (probe.state === "idle") {
		return "first check once a wait begins";
	}
	const errors = errorsInARow(probe.runs);
	const said =
		probe.runs.length === 0
			? "not checked yet"
			: errors === 0
				? probe.passed
					? "holds"
					: "not yet"
				: errors === 1
					? "last check errored"
					: `${errors} errors in a row`;
	return probe.next === undefined
		? said
		: `${said} · next in ${timeLeft(probe.next, now)}`;
}

/** One dot per latest run, oldest first: filled green when it held, red when it errored, a ring for not yet. */
export function CheckDots({
	runs,
	next,
}: {
	runs: readonly ProbeRun[];
	/** Whether a dashed ring for the coming check follows. */
	next: boolean;
}): JSX.Element {
	return (
		<span className="inline-flex items-center gap-1.5">
			<ul className="flex items-center gap-1.5" aria-label="checks">
				{runs.slice(-SHOWN).map((run) => {
					const said =
						run.exit === 0 ? "held" : errored(run) ? "errored" : "not yet";
					return (
						<li
							key={run.at}
							title={`${new Date(run.at).toLocaleTimeString()}: ${said} (exit ${run.exit})`}
							aria-label={said}
							className={cn(
								"size-2.5 rounded-full border-[1.5px]",
								run.exit === 0
									? "border-success bg-success"
									: errored(run)
										? "border-destructive bg-destructive"
										: "border-muted-foreground/70",
							)}
						/>
					);
				})}
			</ul>
			{next && (
				<span
					aria-hidden
					className="size-2.5 rounded-full border-[1.5px] border-muted-foreground/50 border-dashed"
				/>
			)}
		</span>
	);
}

/** A probe's script, folded behind a Script toggle. */
export function ScriptToggle({
	script,
	children,
}: {
	script: string;
	/** What shares the row with the toggle, at its end. */
	children?: React.ReactNode;
}): JSX.Element {
	return (
		<Collapsible className="min-w-0 text-xs">
			<div className="flex flex-wrap items-center gap-2">
				<CollapsibleTrigger
					render={<Button variant="ghost" size="sm" />}
					className="group text-muted-foreground"
				>
					<ChevronRightIcon
						data-icon="inline-start"
						className="transition-transform group-data-panel-open:rotate-90"
					/>
					Script
				</CollapsibleTrigger>
				<span className="flex-1" />
				{children}
			</div>
			<CollapsibleContent>
				<pre className="mt-1.5 overflow-x-auto rounded bg-muted px-3 py-2 font-mono">
					{script}
				</pre>
			</CollapsibleContent>
		</Collapsible>
	);
}
