import type { AutopickRules } from "../autopick";
import { cellLabel, ROUTE_DEPTHS, ROUTE_KINDS } from "../autopick/browser";
import type { HoldoutSide } from "./holdout-comparison";
import type { ScorecardRow } from "./scorecard";

/** How far back the Autopick page looks for possible improvements: 30 days. */
export const IMPROVEMENTS_SPAN = 30 * 24 * 60 * 60 * 1000;

/** A lineup the holdout shows is stronger than some of its cells need. */
export interface OverpoweredLineup {
	lineup: string;
	/** The scorecard rows of its cells whose held-out tasks did as well. */
	cells: ScorecardRow[];
}

/** The lineups with a cell the holdout calls overpowered, the most cells first. */
export function overpoweredLineups(
	rows: readonly ScorecardRow[],
): OverpoweredLineup[] {
	const flagged = rows.filter(
		(row) => row.lineup !== null && row.holdout?.overpowered === true,
	);
	return [...Map.groupBy(flagged, (row) => row.lineup as string)]
		.map(([lineup, cells]) => ({ lineup, cells }))
		.toSorted(
			(left, right) =>
				right.cells.length - left.cells.length ||
				left.lineup.localeCompare(right.lineup),
		);
}

/** Names what is flagged, so a dismissal holds until it changes. */
export function improvementsKey(lineups: readonly OverpoweredLineup[]): string {
	return JSON.stringify(
		lineups
			.flatMap(({ lineup, cells }) =>
				cells.map((row) => `${lineup}:${row.kind}.${row.depth}`),
			)
			.toSorted(),
	);
}

/**
 * The words of the board task that has an agent consider routing the
 * overpowered cells to an easier lineup, or null when none is flagged.
 */
export function improvementsTaskText(
	lineups: readonly OverpoweredLineup[],
	rules: AutopickRules | null,
): string | null {
	if (lineups.length === 0) {
		return null;
	}
	const name = (id: string | null) =>
		id === null
			? "an unrecorded lineup"
			: (rules?.lineups.find((each) => each.id === id)?.name ?? id);
	const lines = lineups.flatMap(({ lineup, cells }) => [
		`- ${name(lineup)}:`,
		...cells.map((row) => {
			const holdout = row.holdout;
			const cell = cellLabel(
				ROUTE_KINDS.find((kind) => kind === row.kind) ?? null,
				ROUTE_DEPTHS.find((depth) => depth === row.depth) ?? null,
			);
			return holdout === null
				? `  - ${cell}`
				: `  - ${cell}: held out on ${name(holdout.easier)}, ${side(holdout.heldOut)}; regular ${side(holdout.regular)}`;
		}),
	]);
	return [
		"Autopick's holdout started some tasks one difficulty easier than their cell's lineup, as an experiment, and in the cells below those held-out tasks did as well as the regular ones over the last 30 days (a problem is a task that hit trouble, was lifted, or was overridden to a stronger pick). Read the numbers, and where they hold up, update the Autopick rules (the Autopick page's rules, saved for this machine) to route those cells to the easier lineup. Say what you changed and why, and what you left alone.",
		"",
		...lines,
	].join("\n");
}

function side({ tasks, problemRate, dollarsPerTask }: HoldoutSide): string {
	const problems =
		problemRate === null
			? "no problems recorded"
			: `${Math.round(problemRate * 100)}% problems`;
	const cost =
		dollarsPerTask === null ? "" : `, $${dollarsPerTask.toFixed(2)} a task`;
	return `${tasks} ${tasks === 1 ? "task" : "tasks"}, ${problems}${cost}`;
}
