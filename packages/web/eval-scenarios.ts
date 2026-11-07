import type {
	EvalScenario,
	EvalScenarioState,
	EvalScenarioStatus,
} from "@splates/server/evals/browser";
import type { AgentPick } from "@splates/server/models";

/** The states in the order the table reads them, worst first. */
export const STATES: EvalScenarioStatus[] = ["failing", "never-run", "passing"];

/** What a state is called on a chip. */
export const STATE_LABEL: Record<EvalScenarioStatus, string> = {
	failing: "Failing",
	"never-run": "Never run",
	passing: "Passing",
};

/** One table row: a listed scenario with where it stands. */
export interface ScenarioRow {
	scenario: EvalScenario;
	state: EvalScenarioState;
}

/** What the table is narrowed to; null for no narrowing on that part. */
export interface ScenarioFilter {
	state: EvalScenarioStatus | null;
	/** A skill or group heading, as `headingOf` has it. */
	project: string | null;
}

/** The heading a scenario sits under: its skill, else its group, else none. */
export function headingOf(scenario: EvalScenario): string {
	return scenario.skill ?? scenario.group ?? "";
}

/** The fraction of runs that passed, 0 for none landed. */
function rate(state: EvalScenarioState): number {
	const total = state.targets.reduce((sum, each) => sum + each.total, 0);
	const passed = state.targets.reduce((sum, each) => sum + each.passed, 0);
	return total === 0 ? 0 : passed / total;
}

/**
 * The listed scenarios paired with their states, worst first, for the table
 * to show. A scenario the states do not know counts as never run.
 */
export function rowsOf(
	scenarios: EvalScenario[],
	states: EvalScenarioState[],
): ScenarioRow[] {
	return scenarios
		.map((scenario, at) => ({
			at,
			scenario,
			state: states.find((each) => each.scenario === scenario.id) ?? {
				scenario: scenario.id,
				state: "never-run" as const,
				targets: [],
				lastRunAt: null,
				run: null,
			},
		}))
		.sort(
			(left, right) =>
				STATES.indexOf(left.state.state) - STATES.indexOf(right.state.state) ||
				(left.state.state === "failing"
					? rate(left.state) - rate(right.state)
					: 0) ||
				left.at - right.at,
		)
		.map(({ scenario, state }) => ({ scenario, state }));
}

/** How many rows are in each state. */
export function countStates(
	rows: ScenarioRow[],
): Record<EvalScenarioStatus, number> {
	const counts = { failing: 0, "never-run": 0, passing: 0 };
	for (const row of rows) {
		counts[row.state.state] += 1;
	}
	return counts;
}

/** The rows that fit the filter. */
export function filterRows(
	rows: ScenarioRow[],
	filter: ScenarioFilter,
): ScenarioRow[] {
	return rows.filter(
		(row) =>
			(filter.state === null || row.state.state === filter.state) &&
			(filter.project === null || headingOf(row.scenario) === filter.project),
	);
}

/** The distinct headings of the rows, in the order first seen; scenarios under none are left out. */
export function projectsOf(rows: ScenarioRow[]): string[] {
	return [...new Set(rows.map((row) => headingOf(row.scenario)))].filter(
		(each) => each !== "",
	);
}

/** The name of the group for scenarios whose id has no namespace. */
export const OTHER_GROUP = "Other";

/** The namespace of a scenario id, the part before the first `/`; `Other` for an id with none. */
export function namespaceOf(id: string): string {
	const slash = id.indexOf("/");
	return slash > 0 ? id.slice(0, slash) : OTHER_GROUP;
}

/** The id without its namespace, such as `focused-tests` for `resources/focused-tests`. */
export function shortNameOf(id: string): string {
	const slash = id.indexOf("/");
	return slash > 0 ? id.slice(slash + 1) : id;
}

/** The rows of one namespace. */
export interface ScenarioGroup {
	name: string;
	rows: ScenarioRow[];
}

/** The rows split by namespace: groups A to Z with `Other` last, and each group's rows A to Z by id. */
export function groupRows(rows: ScenarioRow[]): ScenarioGroup[] {
	const groups = new Map<string, ScenarioRow[]>();
	for (const row of rows) {
		const name = namespaceOf(row.scenario.id);
		groups.set(name, [...(groups.get(name) ?? []), row]);
	}
	return [...groups]
		.map(([name, each]) => ({
			name,
			rows: each.sort((left, right) =>
				left.scenario.id.localeCompare(right.scenario.id),
			),
		}))
		.sort(
			(left, right) =>
				Number(left.name === OTHER_GROUP) -
					Number(right.name === OTHER_GROUP) ||
				left.name.localeCompare(right.name),
		);
}

/** The header line, such as `17 of 31 scenarios passing`. */
export function summaryOf(rows: ScenarioRow[]): string {
	const passing = rows.filter((row) => row.state.state === "passing").length;
	return `${passing} of ${rows.length} ${rows.length === 1 ? "scenario" : "scenarios"} passing`;
}

/** The name to look a saved agent up by in a scenario state's targets, such as `claude/sonnet@high`; null for an agent with no model. */
export function stateKeyOf(pick: AgentPick): string | null {
	return pick.model === undefined
		? null
		: `${pick.agent}/${pick.model}${pick.effort === undefined ? "" : `@${pick.effort}`}`;
}

/** The pass count a row shows for a saved agent: `2/3`, or none when it did not run there. */
export function passCount(
	state: EvalScenarioState,
	pick: AgentPick,
): string | null {
	const key = stateKeyOf(pick);
	const each = state.targets.find((entry) => entry.target === key);
	return each === undefined ? null : `${each.passed}/${each.total}`;
}
