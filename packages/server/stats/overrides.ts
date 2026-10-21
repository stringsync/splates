import type { Outcome } from "./outcomes";

/** How often the person moved a conversation off what one Auto pick rule set. */
export interface RuleOverrides {
	/** The index in the rules of the rule whose pick was overridden. */
	rule: number;
	/** Times overridden, a model and an effort change each counting. */
	count: number;
	/** What it was moved to, most often first. */
	moves: { aspect: "model" | "effort"; to: string; count: number }[];
}

/**
 * The overrides in `outcomes` by the rule they overrode, the most overridden
 * first, so a rule the person keeps correcting is easy to find.
 */
export function overridesByRule(outcomes: readonly Outcome[]): RuleOverrides[] {
	const byRule = new Map<number, Map<string, RuleOverrides["moves"][number]>>();
	for (const outcome of outcomes) {
		for (const each of outcome.overrides ?? []) {
			const moves = byRule.get(each.rule) ?? new Map();
			const key = `${each.aspect}:${each.to}`;
			const move = moves.get(key) ?? {
				aspect: each.aspect,
				to: each.to,
				count: 0,
			};
			move.count += 1;
			moves.set(key, move);
			byRule.set(each.rule, moves);
		}
	}
	return [...byRule]
		.map(([rule, moves]) => {
			const sorted = [...moves.values()].toSorted(
				(one, other) => other.count - one.count,
			);
			return {
				rule,
				count: sorted.reduce((sum, move) => sum + move.count, 0),
				moves: sorted,
			};
		})
		.toSorted((one, other) => other.count - one.count || one.rule - other.rule);
}
