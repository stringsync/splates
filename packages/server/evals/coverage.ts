import type { AgentPick } from "../models";
import { DEFAULT_PASS, type PassRule, standingOf } from "./pass-rule";
import { targetOf } from "./target";
import type { EvalCell, EvalGrid, EvalTarget } from "./types";

/**
 * How many runs of a scenario leave out an agent that just passed it: the
 * scenario's next two runs skip it, and the one after asks for it again, to
 * confirm the changes since did not break it. A time window was the
 * alternative, but a loop's rounds come minutes apart, so it would skip the
 * agent for the whole loop.
 */
export const SKIP_AFTER_PASS = 2;

/**
 * Where a saved agent stands on a scenario, from its last graded runs against
 * the scenario's pass rule: it passed, a pass is out of reach (failing), it has
 * too few graded runs yet (needs runs, which includes only errored ones), or
 * none ran.
 */
export type CoverageState = "passed" | "failing" | "needs-runs" | "never-run";

/** One saved agent on one scenario, from every batch saved. */
export interface AgentCoverage {
	/** The agent as a run card's `Agents:` line names it. */
	agent: string;
	state: CoverageState;
	/** The run of its latest pass, `<batch>#<cell>`; null when it never passed. */
	lastPass: string | null;
	/** Runs of the scenario since its latest pass, on any agent; null when it never passed. */
	runsSincePass: number | null;
	/** Whether the next run leaves it out, having passed within the last `SKIP_AFTER_PASS` runs. */
	skip: boolean;
}

/** One scenario's coverage across the saved agents, in their saved order. */
export interface ScenarioCoverage {
	scenario: string;
	agents: AgentCoverage[];
}

/**
 * How each of `scenarios` covers each of `picks`, the agents saved on the
 * Evals page, from `grids`. Only runs on the checkout's skill count, never a
 * baseline's column; a run that errored or is pending says nothing of the
 * skill, so it is not graded: an agent with only those still needs runs.
 * `rules` holds the specs that set their own pass rule; the rest use 2 of 3.
 */
export function coverage(
	scenarios: readonly string[],
	picks: readonly AgentPick[],
	grids: readonly EvalGrid[],
	rules: ReadonlyMap<string, PassRule> = new Map(),
): ScenarioCoverage[] {
	const oldestFirst = [...grids].sort((first, second) =>
		first.startedAt.localeCompare(second.startedAt),
	);
	return scenarios.map((scenario) => {
		// Each run of the scenario: a batch's landed cells of it on the checkout's skill.
		const runs = oldestFirst
			.map((grid) => {
				const current = new Map(
					grid.targets
						.filter((target) => target.skill === null)
						.map((target) => [target.key, target]),
				);
				return grid.grid.flatMap((cell) => {
					const target = current.get(cell.target);
					return cell.scenario === scenario &&
						cell.run !== null &&
						target !== undefined
						? [{ cell, target }]
						: [];
				});
			})
			.filter((cells) => cells.length > 0);
		return {
			scenario,
			agents: picks.map((pick) =>
				agentCoverage(pick, runs, rules.get(scenario) ?? DEFAULT_PASS),
			),
		};
	});
}

function agentCoverage(
	pick: AgentPick,
	runs: readonly { cell: EvalCell; target: EvalTarget }[][],
	rule: PassRule,
): AgentCoverage {
	const mine = runs.map((cells) =>
		cells.filter(({ target }) => matches(pick, target)).map(({ cell }) => cell),
	);
	const passed = (cells: EvalCell[]) =>
		cells.length > 0 && cells.every((cell) => cell.run?.status === "pass");
	const latest = mine.findLastIndex((cells) => cells.length > 0);
	const passIndex = mine.findLastIndex(passed);
	const lastPass =
		passIndex === -1 ? null : (mine[passIndex]?.[0]?.run?.id ?? null);
	const runsSincePass = passIndex === -1 ? null : runs.length - 1 - passIndex;
	const graded = mine
		.flat()
		.filter(
			(cell) => cell.run?.status === "pass" || cell.run?.status === "fail",
		)
		.map((cell) => cell.run?.status === "pass");
	const { standing } = standingOf(graded, rule);
	const state: CoverageState =
		latest === -1
			? "never-run"
			: standing === "pass"
				? "passed"
				: standing === "fail"
					? "failing"
					: "needs-runs";
	return {
		agent: targetOf(pick),
		state,
		lastPass,
		runsSincePass,
		skip:
			state === "passed" &&
			latest === passIndex &&
			runsSincePass !== null &&
			runsSincePass < SKIP_AFTER_PASS,
	};
}

/** Whether `target` ran `pick`: its agent, and its model and thinking level where the pick names them. */
function matches(pick: AgentPick, target: EvalTarget): boolean {
	return (
		target.agent === pick.agent &&
		(pick.model === undefined || target.model === pick.model) &&
		(pick.effort === undefined || target.effort === pick.effort)
	);
}

/**
 * The agents the next run names, across `scenarios`: each agent any scenario
 * needs, those failing first, then those never run, then passes due a
 * confirming run; empty when every agent passed every scenario recently.
 */
export function nextAgents(scenarios: readonly ScenarioCoverage[]): string[] {
	const rank: Record<CoverageState, number> = {
		failing: 0,
		"needs-runs": 1,
		"never-run": 1,
		passed: 2,
	};
	const best = new Map<string, number>();
	const order: string[] = [];
	for (const scenario of scenarios) {
		for (const each of scenario.agents) {
			if (each.skip) {
				continue;
			}
			if (!best.has(each.agent)) {
				order.push(each.agent);
			}
			best.set(
				each.agent,
				Math.min(best.get(each.agent) ?? 3, rank[each.state]),
			);
		}
	}
	return order
		.map((agent, index) => ({ agent, index, rank: best.get(agent) ?? 3 }))
		.sort(
			(first, second) => first.rank - second.rank || first.index - second.index,
		)
		.map(({ agent }) => agent);
}
