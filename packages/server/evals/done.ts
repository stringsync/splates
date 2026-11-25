import { evalsDoneReference } from "../plans";
import {
	type AgentCoverage,
	nextAgents,
	type ScenarioCoverage,
	SKIP_AFTER_PASS,
} from "./coverage";
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
 * opened. `covered` is how the batch's scenarios cover the agents saved on
 * the Evals page, over every batch: it closes the report with each one's
 * standing and the agents the next run names, or that every one passed.
 */
export function evalsDonePrompt(
	grid: EvalGrid,
	details: readonly EvalDetail[],
	covered: readonly ScenarioCoverage[] = [],
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
${covered.length === 0 ? "" : `\n${coverageSection(covered)}\n`}`;
}

/**
 * Each scenario's standing on each saved agent, then the `Agents:` line the
 * next run card copies: failing agents first, then those never run, leaving
 * out any that passed within the scenario's last runs; or, once every saved
 * agent passed every scenario, that the loop can stop.
 */
function coverageSection(covered: readonly ScenarioCoverage[]): string {
	const agents = covered[0]?.agents.map((each) => each.agent) ?? [];
	const table = [
		`| Scenario | ${agents.map((agent) => `\`${agent}\``).join(" | ")} |`,
		`| --- |${" --- |".repeat(agents.length)}`,
		...covered.map(
			(scenario) =>
				`| \`${scenario.scenario}\` | ${scenario.agents.map(standing).join(" | ")} |`,
		),
	];
	const next = nextAgents(covered);
	const unpassed = covered.flatMap((scenario) =>
		scenario.agents
			.filter((each) => each.state !== "passed")
			.map((each) => `\`${scenario.scenario}\` on \`${each.agent}\``),
	);
	const advice =
		unpassed.length === 0 && next.length === 0
			? "Every saved agent has passed every scenario here: the loop can stop."
			: [
					`The next run card names these agents, failing first, leaving out any that passed within the scenario's last ${SKIP_AFTER_PASS} runs:\n\nAgents: ${next.map((agent) => `\`${agent}\``).join(", ")}\n`,
					unpassed.length === 0
						? "Every saved agent has passed: this run only confirms passes the changes since could have broken."
						: `Not yet passed: ${unpassed.join(", ")}. The loop goes on until these pass or the user declines more eval budget; if it stops first, the final report names them.`,
				].join("\n");
	return `Coverage of the saved eval agents, over every batch:\n\n${table.join("\n")}\n\n${advice}`;
}

function standing(each: AgentCoverage): string {
	switch (each.state) {
		case "never-run":
			return "never run";
		case "needs-runs":
			return "needs runs";
		case "failing":
			return each.lastPass === null ? "failing, never passed" : "failing";
		case "passed":
			return `passed ${each.runsSincePass === 0 ? "this run" : `${each.runsSincePass} ${each.runsSincePass === 1 ? "run" : "runs"} ago`}${each.skip ? ", skip next" : ", rerun next"}`;
	}
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
