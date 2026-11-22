import type { Pairing } from "../conversations";
import type { Outcome } from "./outcomes";

/**
 * How often the person moved a conversation off what Auto pick set for one
 * cell of its routes: a kind at a depth, `unsure` for either the judge was
 * not sure of.
 */
export interface CellOverrides {
	kind: string;
	depth: string;
	/** Times overridden: each conversation's changes count once, as one move. */
	count: number;
	/** The pairings it was moved between, most often first. */
	moves: { from: Pairing; to: Pairing; count: number }[];
	/** Overrides made before pairings were recorded, which show no move. */
	earlier: number;
}

/**
 * The overrides in `outcomes` by the cell of the task they overrode, the most
 * overridden first, so a cell the person keeps correcting is easy to find.
 * A task's changes to model and effort are one move, from the pairing before
 * the first to the pairing after the last.
 */
export function overridesByCell(outcomes: readonly Outcome[]): CellOverrides[] {
	const byCell = new Map<
		string,
		{
			kind: string;
			depth: string;
			earlier: number;
			moves: Map<string, CellOverrides["moves"][number]>;
		}
	>();
	for (const outcome of outcomes) {
		const each = outcome.overrides ?? [];
		if (each.length === 0) {
			continue;
		}
		const kind = each[0]?.kind ?? "unsure";
		const depth = each[0]?.depth ?? "unsure";
		const cell = byCell.get(`${kind}.${depth}`) ?? {
			kind,
			depth,
			earlier: 0,
			moves: new Map(),
		};
		byCell.set(`${kind}.${depth}`, cell);
		const first = each.find((one) => one.from !== undefined)?.from;
		const last = each.findLast((one) => one.result !== undefined)?.result;
		if (first === undefined || last === undefined) {
			cell.earlier += each.length;
			continue;
		}
		const key = JSON.stringify([first, last]);
		const move = cell.moves.get(key) ?? { from: first, to: last, count: 0 };
		move.count += 1;
		cell.moves.set(key, move);
	}
	return [...byCell.values()]
		.map(({ kind, depth, moves, earlier }) => {
			const sorted = [...moves.values()].toSorted(
				(one, other) => other.count - one.count,
			);
			return {
				kind,
				depth,
				count: sorted.reduce((sum, move) => sum + move.count, earlier),
				moves: sorted,
				earlier,
			};
		})
		.toSorted((one, other) => other.count - one.count);
}

function pairing(each: Pairing): string {
	return [each.model, each.effort].filter(Boolean).join(" · ") || "unknown";
}

/**
 * The words of the board task that has an agent update the Auto pick rules
 * from `cells`, or null when nothing was overridden.
 */
export function overridesTaskText(
	cells: readonly CellOverrides[],
): string | null {
	if (cells.length === 0) {
		return null;
	}
	const lines = cells.map((cell) => {
		const moves = cell.moves.map(
			(move) =>
				`  - ${pairing(move.from)} to ${pairing(move.to)}, ${move.count} ${move.count === 1 ? "time" : "times"}`,
		);
		if (cell.earlier > 0) {
			moves.push(`  - ${cell.earlier} earlier, with no pairing recorded`);
		}
		return [
			`- ${cell.kind} at ${cell.depth} depth: ${cell.count} overridden`,
			...moves,
		].join("\n");
	});
	return [
		"The user keeps moving conversations off what Auto pick chose. Read the overrides below, a cell being the kind and depth the judge sorted a task into, and update the Auto pick rules (the Auto pick page's rules, saved for this machine) so each cell that is often overridden picks what the user moves it to. Leave alone a cell overridden once or twice, and say what you changed and why.",
		"",
		...lines,
	].join("\n");
}
