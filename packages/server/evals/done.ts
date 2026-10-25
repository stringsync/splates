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
const TALLY: EvalStatus[] = [
	"pass",
	"fail",
	"uncovered",
	"bound",
	"infrastructure-error",
	"unsupported",
	"unreadable",
	"pending",
];

/** `claude sonnet high` for a target, as the page names it. */
export function targetName(target: EvalTarget): string {
	return [target.agent, target.model, target.effort]
		.filter((part) => part !== null)
		.join(" ");
}

/**
 * What tells the agent whose run evals card started `grid` that it is done:
 * the directive, then the batch condensed: its tally and cost, each probe's
 * outcome on each agent, and for each run that did not pass, the checks that
 * held it back, its reply cut short, and where its trace is. `details` are
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
	const probes = [...new Set(grid.grid.map((cell) => cell.probe))];
	const table = [
		`| Probe | ${grid.targets.map(targetName).join(" | ")} |`,
		`| --- |${" --- |".repeat(grid.targets.length)}`,
		...probes.map(
			(probe) =>
				`| \`${probe}\` | ${grid.targets
					.map((target) =>
						outcomes(
							grid.grid.filter(
								(cell) => cell.probe === probe && cell.target === target.key,
							),
						),
					)
					.join(" | ")} |`,
		),
	];
	const missed = details.map((run) => {
		const checks = run.checks
			.filter((check) => check.status !== "pass")
			.map(
				(check) =>
					`  - \`${check.id}\` (${check.assertion.kind}, ${check.status}): expected ${cut(JSON.stringify(check.expected))}, actual ${cut(JSON.stringify(check.actual))}`,
			);
		const stopped =
			run.termination === "stop"
				? ""
				: `, stopped early: ${run.termination}${run.detail === null ? "" : ` (${cut(run.detail)})`}`;
		return [
			`- \`${run.probe}\` on ${targetName(run.target)}, repetition ${run.repetition + 1}: ${run.status}${stopped}`,
			...checks,
			`  - Reply: ${run.reply === null ? "(none)" : cut(JSON.stringify(run.reply))}`,
			`  - Trace: \`${run.logs}\``,
		].join("\n");
	});
	return `${evalsDoneReference(grid.id)}

The run your run evals card asked for is done: ${grid.cells} ${grid.cells === 1 ? "cell" : "cells"}${tally === "" ? "" : ` · ${tally}`}${cost.length === 0 ? "" : ` · ${cost.join(" · ")}`}.

${table.join("\n")}
${missed.length === 0 ? "\nEvery run passed." : `\nNot passing:\n\n${missed.join("\n")}`}
`;
}

/** One probe's outcome on one agent, a word per repetition. */
function outcomes(cells: readonly EvalCell[]): string {
	return cells.length === 0
		? "not run"
		: cells.map((cell) => cell.run?.status ?? "pending").join(", ");
}

function cut(text: string): string {
	return text.length <= CUT ? text : `${text.slice(0, CUT)}…`;
}
