import { evalsDoneReference } from "../plans";
import { targetName } from "./target";
import type { EvalCell, EvalDetail, EvalGrid, EvalStatus } from "./types";

/** How long a value or a reply is let run in the condensed report. */
const CUT = 240;

/** The order a tally reads in, as the Evals page's does. */
const TALLY: EvalStatus[] = ["pass", "fail", "error", "unreadable", "pending"];

/**
 * What tells the agent whose run evals card started `grid` that it is done:
 * the directive, then the batch condensed: its tally and cost, each scenario's
 * outcome on each agent (a pass rate over repetitions), and for each run that
 * failed, the checks and the judge's reason that held it back, its reply cut
 * short and how to show it in full; then the runs that errored, apart, since
 * an error is never the skill's. `details` are the runs that did not pass,
 * opened.
 */
export function evalsDonePrompt(
	grid: EvalGrid,
	details: readonly EvalDetail[],
): string {
	const tally = TALLY.filter((status) => grid.tally[status])
		.map((status) => `${grid.tally[status]} ${status}`)
		.join(" · ");
	const cost = [
		grid.tokens === null ? null : `${grid.tokens.toLocaleString()} tokens`,
		grid.costUsd === null ? null : `$${grid.costUsd.toFixed(2)}`,
	].filter((part) => part !== null);
	const scenarios = [...new Set(grid.grid.map((cell) => cell.scenario))];
	const table = [
		`| Scenario | ${grid.targets.map(targetName).join(" | ")} |`,
		`| --- |${" --- |".repeat(grid.targets.length)}`,
		...scenarios.map(
			(scenario) =>
				`| \`${scenario}\` | ${grid.targets
					.map((target) =>
						outcomes(
							grid.grid.filter(
								(cell) =>
									cell.scenario === scenario && cell.target === target.key,
							),
						),
					)
					.join(" | ")} |`,
		),
	];
	const missed = (runs: readonly EvalDetail[]) =>
		runs.map((run) => {
			const held = [
				...run.checks
					.filter((check) => !check.pass)
					.map(
						(check) =>
							`  - Check \`${check.id}\`: ${check.about}${check.error === undefined ? "" : ` (${cut(check.error)})`}`,
					),
				...(run.judge?.pass === false
					? [`  - Judge: ${cut(run.judge.reason)}`]
					: []),
				...(run.error === undefined ? [] : [`  - Error: ${cut(run.error)}`]),
			];
			return [
				`- \`${run.scenario}\` on ${targetName(run.target)}, repetition ${run.repetition + 1}: ${run.status}`,
				...held,
				`  - Reply: ${run.reply === "" ? "(none)" : cut(JSON.stringify(run.reply))}`,
				`  - Run: \`${run.id}\`, in full with \`splates dev eval show ${run.id}\``,
			].join("\n");
		});
	const failed = missed(details.filter((run) => run.status !== "error"));
	const errored = missed(details.filter((run) => run.status === "error"));
	const sections = [
		...(failed.length === 0 ? [] : [`Not passing:\n\n${failed.join("\n")}`]),
		...(errored.length === 0
			? []
			: [
					`Errors, the harness's or the setup's, never the skill's:\n\n${errored.join("\n")}`,
				]),
	];
	return `${evalsDoneReference(grid.id)}

The run your run evals card asked for is done: ${grid.cells} ${grid.cells === 1 ? "cell" : "cells"}${tally === "" ? "" : ` · ${tally}`}${cost.length === 0 ? "" : ` · ${cost.join(" · ")}`}.

${table.join("\n")}
${sections.length === 0 ? "\nEvery run passed." : `\n${sections.join("\n\n")}`}
`;
}

/**
 * One scenario's outcome on one agent: its status for a single run, or for
 * repetitions the pass rate of those graded, with errors and pending counted
 * apart, since neither says anything of the skill.
 */
function outcomes(cells: readonly EvalCell[]): string {
	if (cells.length === 0) {
		return "not run";
	}
	const statuses = cells.map((cell) => cell.run?.status ?? "pending");
	if (statuses.length === 1) {
		return statuses[0] ?? "pending";
	}
	const count = (status: string) =>
		statuses.filter((each) => each === status).length;
	const graded = statuses.filter(
		(each) => each !== "error" && each !== "pending",
	).length;
	return [
		`${count("pass")}/${graded} pass`,
		...(["error", "pending"] as const)
			.filter((status) => count(status) > 0)
			.map((status) => `${count(status)} ${status}`),
	].join(", ");
}

function cut(text: string): string {
	return text.length <= CUT ? text : `${text.slice(0, CUT)}…`;
}
