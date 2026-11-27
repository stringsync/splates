import type { RouteDepth, RouteKind } from "../autopick";
import { cellLabel } from "../autopick/browser";
import type { Pairing } from "../conversations";
import type { CellOverrides } from "./overrides";
import type { ScorecardRow } from "./scorecard";

/** Where a flagged row's evidence points: the judge, or the lineup up or down. */
export type RulesTarget = "judge" | "keep" | "up" | "down" | "easier";

/** What a scorecard row points the rules at, or null for a row not flagged. */
export function rulesTarget(row: ScorecardRow): RulesTarget | null {
	// Many lifts mean the judge put tasks too shallow, unless most came from
	// the holdout's easier start, which says the lineup is right. A strong row
	// may overpay, but moving down waits on the holdout measuring it.
	if (row.verdict === "strong") {
		return row.signals.includes("holdout") ? "easier" : "down";
	}
	if (row.verdict !== "weak") {
		return null;
	}
	if (row.signals.includes("lifts")) {
		return row.liftedInHoldout ? "keep" : "judge";
	}
	return "up";
}

const READING: Record<RulesTarget, string> = {
	judge:
		"points at the judge: tasks were lifted after they started, so the judge is placing work too shallow. Propose a change to the depth criteria rather than the lineup.",
	keep: "points at the lineup staying as it is: most lifts came from tasks the holdout started a step easier, so the step down does not hold up.",
	up: "points at the lineup: tasks hit trouble without a lift, or the user moved them up. Propose a lineup a step stronger.",
	down: "points at the lineup possibly being too strong: it costs well over the next pick down with little trouble. Do not move it down outright; propose measuring it with the down-step holdout (Settings), which starts a share of tasks a step easier.",
	easier:
		"points at the lineup being stronger than the cell needs: the holdout started a share of its tasks a step easier, and they did as well as the regular ones. Propose routing the cell to the easier lineup.",
};

/**
 * The words of the board task that has an agent propose Autopick rule
 * changes from the scorecard's flagged rows, each with its numbers, what it
 * points at and the overrides in its cell; null when no row is flagged.
 */
export function rulesTaskText({
	rows,
	overrides,
	minimumTasks,
}: {
	rows: readonly ScorecardRow[];
	overrides: readonly CellOverrides[];
	minimumTasks: number;
}): string | null {
	const flagged = rows.flatMap((row) => {
		const target = rulesTarget(row);
		return target === null ? [] : [{ row, target }];
	});
	if (flagged.length === 0) {
		return null;
	}
	const sections = flagged.map(({ row, target }) => {
		const cell = overrides.find(
			(each) =>
				each.kind === (row.kind ?? "unsure") &&
				each.depth === (row.depth ?? "unsure"),
		);
		return [
			`- ${label(row)}: ${figures(row)}`,
			`  It ${READING[target]}`,
			...(row.suggestion === null
				? []
				: [`  The scorecard suggests: ${row.suggestion}.`]),
			...(cell === undefined ? [] : moves(cell)),
		].join("\n");
	});
	const sparse = rows.filter((row) => row.verdict === "sparse");
	return [
		"The Autopick scorecard flags the cells below, a cell being the kind and depth the judge sorted a task into, under the lineup it routed to. Read each one's evidence and propose changes to the Autopick rules (the Autopick page's rules, saved for this machine): a lineup a step up or down, or, where it points at the judge, a change to the depth criteria instead.",
		"",
		"Propose them with a plan card, one change per flagged cell with the numbers it rests on, and change nothing until the user approves.",
		"",
		...sections,
		...(sparse.length === 0
			? []
			: [
					"",
					`Leave alone the cells with fewer than ${minimumTasks} tasks, too few to judge: ${sparse.map((row) => `${label(row)} (${row.tasks})`).join(", ")}.`,
				]),
	].join("\n");
}

function label(row: ScorecardRow): string {
	const cell = cellLabel(
		row.kind as RouteKind | null,
		row.depth as RouteDepth | null,
	);
	return row.lineup === null ? cell : `${cell}, ${row.lineup} lineup`;
}

function figures(row: ScorecardRow): string {
	return [
		`${row.tasks} tasks`,
		row.dollarsPerTask === null
			? "no cost recorded"
			: `$${row.dollarsPerTask.toFixed(2)}/task`,
		`trouble ${percent(row.troubleRate)}`,
		`corrections ${percent(row.correctionRate)}`,
		`${row.lifts} ${row.lifts === 1 ? "lift" : "lifts"}`,
		`overrides ${row.overridesUp} up, ${row.overridesDown} down`,
		...(row.comparison === null
			? []
			: [
					`${row.comparison.ratio.toFixed(1)}× the next pick down ($${row.comparison.cost.toFixed(2)} against $${row.comparison.nextCost.toFixed(2)})`,
				]),
		...(row.holdout === null
			? []
			: [
					`held out a step easier on ${row.holdout.easier ?? "an unrecorded lineup"}: ${row.holdout.heldOut.tasks} tasks with ${percent(row.holdout.heldOut.problemRate)} problems, against ${row.holdout.regular.tasks} regular with ${percent(row.holdout.regular.problemRate)}`,
				]),
	].join(", ");
}

function percent(value: number | null): string {
	return value === null ? "unknown" : `${Math.round(value * 100)}%`;
}

function moves(cell: CellOverrides): string[] {
	return [
		...cell.moves.map(
			(move) =>
				`  - moved ${pairing(move.from)} to ${pairing(move.to)}, ${move.count} ${move.count === 1 ? "time" : "times"}`,
		),
		...(cell.earlier > 0
			? [`  - ${cell.earlier} earlier overrides, with no pairing recorded`]
			: []),
	];
}

function pairing(each: Pairing): string {
	return [each.model, each.effort].filter(Boolean).join(" · ") || "unknown";
}
