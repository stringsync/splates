import type { Pairing } from "../conversations";
import type { RosterAgent } from "../models";
import { type ModelProvider, modelProvider } from "./model-provider";
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

/** Recorded moves for a lineup in a cell, with null when the lineup is unknown. */
export interface LineupOverrides extends CellOverrides {
	lineup: string | null;
	moves: (CellOverrides["moves"][number] & {
		fromProvider: ModelProvider | null;
		toProvider: ModelProvider | null;
	})[];
}

/** Keeps old overrides in their cell even when the lineup was not recorded. */
export function overridesByLineup(
	outcomes: readonly Outcome[],
	agents: readonly RosterAgent[],
): LineupOverrides[] {
	const groups = new Map<string | null, Outcome[]>();
	for (const outcome of outcomes) {
		const first = outcome.overrides?.[0];
		if (first === undefined) {
			continue;
		}
		const pick = outcome.autoPick;
		const matchingPick =
			(pick?.kind ?? null) === (first.kind ?? null) &&
			(pick?.depth ?? null) === (first.depth ?? null);
		const lineup = first.lineup ?? (matchingPick ? pick?.lineup : null) ?? null;
		const group = groups.get(lineup) ?? [];
		group.push(outcome);
		groups.set(lineup, group);
	}
	return [...groups].flatMap(([lineup, group]) =>
		overridesByCell(group).map((cell) => ({
			...cell,
			lineup,
			moves: cell.moves.map((move) => ({
				...move,
				fromProvider: modelProvider(move.from.model, agents),
				toProvider: modelProvider(move.to.model, agents),
			})),
		})),
	);
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
