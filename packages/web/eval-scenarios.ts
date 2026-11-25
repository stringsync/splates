import type {
	EvalScenario,
	EvalScenarioState,
	EvalScenarioStatus,
} from "@splates/server/evals/browser";
import type { AgentPick } from "@splates/server/models";

/** The states in the order the table reads them, worst first. */
export const STATES: EvalScenarioStatus[] = [
	"failing",
	"needs-runs",
	"never-run",
	"passing",
];

/** One table row: a listed scenario with where it stands. */
export interface ScenarioRow {
	scenario: EvalScenario;
	state: EvalScenarioState;
}

/** What the list is narrowed to: one state, or null for every spec. */
export interface ScenarioFilter {
	state: EvalScenarioStatus | null;
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
	const counts = { failing: 0, "needs-runs": 0, "never-run": 0, passing: 0 };
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
		(row) => filter.state === null || row.state.state === filter.state,
	);
}

/** The sentence a spec reads as: its `it(...)`, else what it checks, else its id. */
export function titleOf(scenario: EvalScenario): string {
	return scenario.sentence ?? scenario.about ?? scenario.id;
}

/** The suite of cases that name none. */
const OTHER = "Other";

/** Where a spec sits: its suite, then the group under it, `""` for none; a case without `describe` groups sits under its skill or group heading. */
export function placeOf(scenario: EvalScenario): {
	suite: string;
	group: string;
} {
	const groups = scenario.groups ?? [];
	if (groups.length > 0) {
		return { suite: groups[0] ?? "", group: groups.slice(1).join(" › ") };
	}
	return { suite: scenario.skill ?? scenario.group ?? OTHER, group: "" };
}

/** A `describe` group under a suite: its specs, worst first. */
export interface SpecGroup {
	/** The group's path under its suite, such as `context budget`. */
	name: string;
	rows: ScenarioRow[];
}

/** A suite: its specs straight under it and its groups A to Z. */
export interface SpecSuite {
	name: string;
	/** Every spec in the suite, its groups' included. */
	rows: ScenarioRow[];
	/** Specs in no group under the suite. */
	loose: ScenarioRow[];
	groups: SpecGroup[];
}

/** The rows as suites in the order their first row comes, each split into its groups. */
export function suitesOf(rows: ScenarioRow[]): SpecSuite[] {
	const suites = new Map<string, SpecSuite>();
	for (const row of rows) {
		const { suite, group } = placeOf(row.scenario);
		let each = suites.get(suite);
		if (each === undefined) {
			each = { name: suite, rows: [], loose: [], groups: [] };
			suites.set(suite, each);
		}
		each.rows.push(row);
		if (group === "") {
			each.loose.push(row);
			continue;
		}
		let under = each.groups.find((entry) => entry.name === group);
		if (under === undefined) {
			under = { name: group, rows: [] };
			each.groups.push(under);
		}
		under.rows.push(row);
	}
	for (const each of suites.values()) {
		each.groups.sort((left, right) => left.name.localeCompare(right.name));
	}
	return [...suites.values()];
}

/** An eval file on the Evals page: the specs it holds, each opening on a page of its own. */
export interface SpecFile {
	/** What its address names it by: its path as listed, or its suite for a spec listed with no file. */
	key: string;
	/** Its own name, such as `core-loop.ts`, or its suite's. */
	name: string;
	/** The folder it sits in, ending in `/`, such as `skills/splates/evals/`; empty for a suite. */
	folder: string;
	/** Its absolute path, for an editor to open; null when the list does not say. */
	at: string | null;
	rows: ScenarioRow[];
}

/** The file a spec is listed from, its suite standing in for a project that lists none. */
export function fileKeyOf(scenario: EvalScenario): string {
	return scenario.file ?? placeOf(scenario).suite;
}

/** The rows by the file that holds them, files A to Z by path. */
export function filesOf(rows: ScenarioRow[]): SpecFile[] {
	const files = new Map<string, SpecFile>();
	for (const row of rows) {
		const key = fileKeyOf(row.scenario);
		let each = files.get(key);
		if (each === undefined) {
			const listed = row.scenario.file;
			const cut = listed === undefined ? -1 : listed.lastIndexOf("/");
			each = {
				key,
				name: listed === undefined ? key : listed.slice(cut + 1),
				folder: listed === undefined ? "" : listed.slice(0, cut + 1),
				at: row.scenario.fileAt ?? null,
				rows: [],
			};
			files.set(key, each);
		}
		each.rows.push(row);
	}
	return [...files.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

/** A spec's pass rate in its latest batch, as a whole percent; null when it never ran. */
export function passRateOf(state: EvalScenarioState): number | null {
	const total = state.targets.reduce((sum, each) => sum + each.total, 0);
	return total === 0 ? null : Math.round(rate(state) * 100);
}

/** What a needs-runs spec's row shows beside "needs runs": the passes of the first agent still short, as `1/3`; null for any other state. */
export function needsRunsCount(state: EvalScenarioState): string | null {
	const short =
		state.state === "needs-runs"
			? state.targets.find((each) => each.standing === "needs-runs")
			: undefined;
	return short === undefined ? null : `${short.passed}/${short.of}`;
}

/** What a suite or group says of its specs: `3 failing · 2 passing`, or `not run`. */
export function tallyOf(rows: ScenarioRow[]): string {
	const counts = countStates(rows);
	const parts = [
		counts.failing > 0 ? `${counts.failing} failing` : null,
		counts["needs-runs"] > 0 ? `${counts["needs-runs"]} need runs` : null,
		counts.passing > 0 ? `${counts.passing} passing` : null,
	].filter((each) => each !== null);
	return parts.length === 0 ? "not run" : parts.join(" · ");
}

/** `1 spec`, `6 specs`. */
export function specCount(count: number): string {
	return `${count} ${count === 1 ? "spec" : "specs"}`;
}

/** The header line, such as `17 of 31 specs passing`. */
export function summaryOf(rows: ScenarioRow[]): string {
	const passing = rows.filter((row) => row.state.state === "passing").length;
	return `${passing} of ${specCount(rows.length)} passing`;
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

/** The fraction of runs that passed, 0 for none landed. */
function rate(state: EvalScenarioState): number {
	const total = state.targets.reduce((sum, each) => sum + each.total, 0);
	const passed = state.targets.reduce((sum, each) => sum + each.passed, 0);
	return total === 0 ? 0 : passed / total;
}
