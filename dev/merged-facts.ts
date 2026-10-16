import { type Measure, measured, outlier } from "../baselines";
import { keptDecisions, madeBy } from "../decided";
import { type FoundFacts, foundFacts } from "../finding-facts";
import type { Landed } from "../landed";
import { duration } from "./stats-advice";

/** What the merged card says of how a task went, a line each. */
export interface MergedFacts extends FoundFacts {
	stats: Stat[];
}

/** One figure, beside its project's usual. */
export interface Stat {
	label: string;
	/** Lines added and removed for a size, and calls by who made them, which the card colors. */
	value: string | Lines | Decided;
	/** What it was made of, as working beside waiting; null for nothing more. */
	detail: string | null;
	/** Past its project's 90th percentile, or twice its median. */
	high: boolean;
}

export interface Lines {
	added: number;
	removed: number;
}

/** What the card says of `landed`, from what its outcome kept. */
export function mergedFacts({ outcome, baseline }: Landed): MergedFacts {
	const values = measured(outcome);
	const stat = (
		measure: Measure,
		label: string,
		value: Stat["value"],
		detail: string | null,
	): Stat => {
		const spread = baseline?.measures[measure] ?? null;
		const own = values[measure];
		return {
			label,
			value,
			detail,
			high: own !== null && outlier(own, spread),
		};
	};
	const stats: Stat[] = [
		stat(
			"spentMs",
			"Time",
			duration(values.spentMs ?? 0),
			outcome.workedMs === undefined
				? null
				: `worked ${duration(outcome.workedMs)} · waited ${duration(outcome.waitedMs ?? 0)}`,
		),
	];
	if (outcome.usage !== undefined) {
		const read = `${tokens(outcome.usage.input)} in · ${tokens(outcome.usage.output)} out`;
		stats.push(
			outcome.usage.cost === null
				? { label: "Tokens", value: read, detail: null, high: false }
				: stat("cost", "Cost", dollars(outcome.usage.cost.amount), read),
		);
	}
	if (outcome.size !== undefined) {
		stats.push(
			stat(
				"lines",
				"Size",
				{ added: outcome.size.added, removed: outcome.size.removed },
				`${outcome.size.files} ${outcome.size.files === 1 ? "file" : "files"}`,
			),
		);
	}
	// Older outcomes kept no calls, so they say nothing of them.
	if (keptDecisions(outcome)) {
		stats.push(
			stat(
				"decidedByYou",
				"Decisions",
				{
					byYou: madeBy(outcome, "decidedByYou"),
					byAgent: madeBy(outcome, "decidedByAgents"),
				},
				null,
			),
		);
	}
	return { stats, ...foundFacts({ outcome, baseline }) };
}

/** The calls a task made, by who made them. */
export interface Decided {
	byYou: number;
	byAgent: number;
}

function dollars(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

function tokens(count: number): string {
	return count < 1000
		? `${count}`
		: count < 1_000_000
			? `${(count / 1000).toFixed(1)}k`
			: `${(count / 1_000_000).toFixed(1)}M`;
}
