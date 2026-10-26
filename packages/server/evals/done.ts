import { evalsDoneReference } from "../plans";
import type {
	EvalCell,
	EvalDetail,
	EvalGrid,
	EvalStatus,
	EvalTarget,
} from "./types";

/** How long a value or a reply is let run in the condensed report. */
const CUT = 240;

/** The order a tally reads in, as the Evals page's does. */
const TALLY: EvalStatus[] = ["pass", "fail", "error", "unreadable", "pending"];

/** `claude sonnet high`, then `@<revision>` for a baseline skill, as the page names a target. */
export function targetName(target: EvalTarget): string {
	return [
		target.agent,
		target.model,
		target.effort,
		target.skill === null ? null : `@${target.skill}`,
	]
		.filter((part) => part !== null)
		.join(" ");
}

/**
 * What tells the agent whose run evals card started `grid` that it is done:
 * the directive, then the batch condensed: its tally and cost, each scenario's
 * outcome on each agent, and for each run that did not pass, the checks and
 * the judge's reason that held it back, or what broke, its reply cut short,
 * and the run's id. `details` are
 * the runs that did not pass, opened.
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
	const missed = details.map((run) => {
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
			`  - Run: \`${run.id}\``,
		].join("\n");
	});
	return `${evalsDoneReference(grid.id)}

The run your run evals card asked for is done: ${grid.cells} ${grid.cells === 1 ? "cell" : "cells"}${tally === "" ? "" : ` · ${tally}`}${cost.length === 0 ? "" : ` · ${cost.join(" · ")}`}.

${table.join("\n")}
${missed.length === 0 ? "\nEvery run passed." : `\nNot passing:\n\n${missed.join("\n")}`}
`;
}

/** One scenario's outcome on one agent, a word per repetition. */
function outcomes(cells: readonly EvalCell[]): string {
	return cells.length === 0
		? "not run"
		: cells.map((cell) => cell.run?.status ?? "pending").join(", ");
}

function cut(text: string): string {
	return text.length <= CUT ? text : `${text.slice(0, CUT)}…`;
}
