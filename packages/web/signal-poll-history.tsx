import type {
	ProbeRun,
	ProbeStart,
	SignalProbe,
} from "@splates/server/signals";
import { ChevronRightIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { ago, errored } from "./signal-of";

/** "46 polls since 11:32, none passed", or "Not polled yet". */
export function historyOf(probe: SignalProbe): string {
	const runs = probe.runs;
	if (runs.length === 0) {
		return "Not polled yet";
	}
	const since = new Date(probe.startedAt).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
	const passed = runs.filter((run) => run.exit === 0).length;
	const broke = runs.filter(errored).length;
	return [
		`${probe.count} ${probe.count === 1 ? "poll" : "polls"} since ${since}`,
		passed === 0 ? "none passed" : `${passed} passed`,
		broke > 0 ? `${broke} errored` : null,
	]
		.filter((each) => each !== null)
		.join(", ");
}

/** The latest polls, newest first, a row each saying when, what it said, how long it took, what started it and whether it fired; a row opens to what it printed. */
export function PollHistory({
	probe,
	now,
}: {
	probe: SignalProbe;
	now: number;
}): JSX.Element {
	const [open, setOpen] = useState<string | null>(null);
	if (probe.runs.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				{probe.state === "idle"
					? "It polls on its own once a wait begins."
					: "No polls yet."}
			</p>
		);
	}
	return (
		<table aria-label="polls" className="w-full table-fixed text-[13px]">
			<thead>
				<tr className="border-b text-left text-[11px] text-muted-foreground uppercase tracking-wide">
					<th className="w-7 py-1.5 font-normal">
						<span className="sr-only">Open</span>
					</th>
					<th className="py-1.5 font-normal">When</th>
					<th className="py-1.5 font-normal">Result</th>
					<th className="w-16 py-1.5 font-normal max-sm:w-0">
						<span className="max-sm:hidden">Took</span>
					</th>
					<th className="w-28 py-1.5 font-normal max-sm:w-0">
						<span className="max-sm:hidden">Started by</span>
					</th>
					<th className="w-16 py-1.5 font-normal">
						<span className="sr-only">Fired</span>
					</th>
				</tr>
			</thead>
			{[...probe.runs].reverse().map((run) => {
				const opened = open === run.at;
				return (
					<tbody key={run.at} className="border-b last:border-b-0">
						<tr
							className={cn(
								"relative hover:bg-muted/40",
								opened && "bg-muted/40",
							)}
						>
							<td className="py-2">
								<button
									type="button"
									aria-expanded={opened}
									aria-label={`poll ${ago(run.at, now)}: ${saidOf(run)}`}
									onClick={() => setOpen(opened ? null : run.at)}
									className="flex min-h-7 items-center after:absolute after:inset-0 max-sm:min-h-9"
								>
									<ChevronRightIcon
										aria-hidden
										className={cn(
											"size-3.5 text-muted-foreground transition-transform",
											opened && "rotate-90",
										)}
									/>
								</button>
							</td>
							<td className="py-2" title={new Date(run.at).toLocaleString()}>
								{ago(run.at, now)}
							</td>
							<td
								className={cn(
									"truncate py-2 font-medium",
									run.exit === 0 && "text-success",
									errored(run) && "text-destructive",
								)}
							>
								{saidOf(run)}
							</td>
							<td className="py-2 text-muted-foreground">
								<span className="max-sm:hidden">
									{run.ms === undefined ? "" : tookOf(run.ms)}
								</span>
							</td>
							<td className="py-2">
								{run.startedBy === "poll now" ? (
									<span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs max-sm:hidden">
										Poll now
									</span>
								) : (
									<span className="text-muted-foreground max-sm:hidden">
										{run.startedBy === undefined
											? ""
											: STARTED_BY[run.startedBy]}
									</span>
								)}
							</td>
							<td className="py-2">
								{run.fired === true && (
									<span className="rounded-full bg-success/15 px-2 py-0.5 text-success text-xs">
										Fired
									</span>
								)}
							</td>
						</tr>
						{opened && (
							<tr>
								<td colSpan={6}>
									<RunDetail run={run} />
								</td>
							</tr>
						)}
					</tbody>
				);
			})}
		</table>
	);
}

const STARTED_BY: Record<ProbeStart, string> = {
	scheduled: "Scheduled",
	wait: "Wait began",
	"poll now": "Poll now",
};

/** What one poll printed, stdout and stderr apart, or together for a run kept before they were. */
function RunDetail({ run }: { run: ProbeRun }): JSX.Element {
	const streams: [string, string][] =
		run.stdout === undefined && run.stderr === undefined
			? [["Output", run.output]]
			: [
					["stdout", run.stdout ?? ""],
					["stderr", run.stderr ?? ""],
				];
	return (
		<div className="flex flex-col gap-2 pt-1 pb-3 pl-7">
			<p className="text-muted-foreground text-xs">
				{[
					new Date(run.at).toLocaleString(),
					`exit ${run.exit}`,
					run.ms === undefined ? null : `took ${tookOf(run.ms)}`,
					run.startedBy === undefined ? null : STARTED_BY[run.startedBy],
				]
					.filter((each) => each !== null)
					.join(" · ")}
			</p>
			{streams.map(([label, text]) => (
				<div key={label} className="flex flex-col gap-1">
					<span className="text-[11px] text-muted-foreground uppercase tracking-wide">
						{label}
					</span>
					<pre
						className={cn(
							"max-h-60 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-xs",
							text === "" && "text-muted-foreground",
						)}
					>
						{text === "" ? "(nothing)" : text}
					</pre>
				</div>
			))}
		</div>
	);
}

/** How long a poll took: "0.4s", "12.0s", "1m 5s". */
export function tookOf(ms: number): string {
	if (ms < 60_000) {
		return `${(ms / 1000).toFixed(1)}s`;
	}
	const seconds = Math.round(ms / 1000);
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** What a poll said, in a word or two. */
function saidOf(run: ProbeRun): string {
	return run.exit === 0
		? "Passed"
		: errored(run)
			? `Errored, exit ${run.exit}`
			: "Not yet";
}
