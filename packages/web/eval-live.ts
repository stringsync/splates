import type { EvalRun } from "@splates/server/conversations";
import type { EvalReportLine, EvalRunReport } from "./eval-report";
import { evalReportOf } from "./eval-report";

/** A running or finished eval as its card shows it. */
export interface EvalLive {
	/** When the run started, in epoch ms. */
	startedAt: number;
	eval: string;
	group: string | null;
	agent: string;
	seeded: number;
	/** Live user turns the script plays, and the one under way. */
	turns: number;
	turn: number;
	checks: { id: string; about: string }[];
	judge: string | null;
	lines: EvalReportLine[];
	usd: number | null;
	/** Whether the agent is still working, or which grading step is. */
	phase: "agent" | "checks" | "judge";
	/** The finished run's report, once it is done. */
	report: EvalRunReport | null;
	/** It ended without a report. */
	stopped: boolean;
	/** The page may cancel it: the run watches for a cancel. */
	cancellable: boolean;
	/** When the person asked to cancel it, in epoch ms, while it has not ended yet. */
	cancelling: number | null;
	/** When it ended on a cancel, in epoch ms. */
	cancelled: number | null;
}

/** `run` as its card shows it, its report read as an `eval-report` fence is. */
export function evalLiveOf(run: EvalRun): EvalLive {
	return {
		startedAt: Date.parse(run.startedAt),
		eval: run.eval,
		group: run.group,
		agent: run.agent,
		seeded: run.seeded,
		turns: run.turns,
		turn: run.turn,
		checks: run.checks,
		judge: run.judge,
		lines: run.lines,
		usd: run.usd,
		phase: run.phase,
		// A harness break reads as an error on the report card.
		report:
			run.report === null
				? null
				: evalReportOf(
						JSON.stringify({
							group: run.group,
							...run.report,
							...(run.report.status === "harness" ? { status: "error" } : {}),
						}),
					),
		stopped: run.stopped === true,
		cancellable: run.cancellable === true,
		cancelling:
			run.cancelling === undefined ? null : Date.parse(run.cancelling),
		cancelled: run.cancelled === undefined ? null : Date.parse(run.cancelled),
	};
}

const PREFIX = "eval ";

/** How an eval run goes among a thread's cards, placed by the time it started. */
export function evalRunId(name: string): string {
	return `${PREFIX}${name}`;
}

export function isEvalRunId(id: string): boolean {
	return id.startsWith(PREFIX);
}

/** The progress file name a card id names. */
export function evalRunOfId(id: string): string {
	return id.slice(PREFIX.length);
}
