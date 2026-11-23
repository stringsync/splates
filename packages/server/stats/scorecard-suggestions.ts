import type { AutoPickRules, Lineup } from "../auto-pick";
import { depthLabel, ROUTE_DEPTHS, ROUTE_KINDS } from "../auto-pick/browser";
import { higher, lineupFor } from "../auto-pick/scoring";
import { type AgentPick, DEFAULT_AGENTS, type RosterAgent } from "../models";
import { modelProvider } from "./model-provider";
import type { OutcomeAutoPick } from "./outcomes";
import type { PickSignal, ScorecardRow } from "./scorecard";

/** A suggested change follows the clearest measured signal on a flagged row. */
export function suggestedChange({
	signals,
	pick,
	cheaper,
	easier = null,
	liftedInHoldout,
	agents,
	rules,
}: {
	signals: readonly PickSignal[];
	pick: OutcomeAutoPick;
	cheaper: OutcomeAutoPick | null;
	/** The lineup the holdout started this cell's tasks on, one difficulty easier. */
	easier?: string | null;
	liftedInHoldout: boolean;
	agents: RosterAgent[];
	rules: AutoPickRules | null;
}): Pick<ScorecardRow, "suggestion" | "suggestionProvider"> {
	if (signals.length === 0) {
		return { suggestion: null };
	}
	const kind = ROUTE_KINDS.find((kind) => kind === pick.kind) ?? null;
	const depth = ROUTE_DEPTHS.find((depth) => depth === pick.depth) ?? null;
	const current = rules === null ? undefined : lineupFor(rules, kind, depth);

	if (signals.includes("lifts")) {
		if (liftedInHoldout) {
			return {
				suggestion:
					current === undefined
						? "Keep the regular pick for this cell"
						: `Keep the ${current.name} lineup`,
			};
		}
		return {
			suggestion:
				depth === null || depth === "unsure"
					? "Recheck the depth criteria"
					: `Recheck ${depthLabel(depth)} depth criteria`,
		};
	}

	if (signals.includes("holdout")) {
		const lineup = rules?.lineups.find((each) => each.id === easier);
		return {
			suggestion:
				lineup === undefined
					? "Try the easier lineup for this cell"
					: `Try the ${lineup.name} lineup`,
		};
	}

	if (cheaper !== null && signals.includes("cost")) {
		const lineup = rules?.lineups.find(
			(each) => each.id === cheaper.lineup && startsWith(each, cheaper),
		);
		if (lineup === undefined) {
			const provider = modelProvider(cheaper.model, agents);
			return {
				suggestion: `Test ${pickName(cheaper, agents)} for this cell`,
				...(provider === null ? {} : { suggestionProvider: provider }),
			};
		}
		return {
			suggestion:
				lineup.id === current?.id
					? `Measure the current ${lineup.name} lineup`
					: `Test the ${lineup.name} lineup`,
		};
	}

	const routed = new Set(Object.values(rules?.routes[kind ?? "unsure"] ?? {}));
	const stronger = nextStronger(
		pick,
		rules?.lineups.filter((each) => routed.has(each.id)) ?? [],
		agents,
	);
	if (stronger === undefined) {
		return { suggestion: "Try a stronger pick for this cell" };
	}
	return {
		suggestion:
			stronger.id === current?.id
				? `Measure the current ${stronger.name} lineup`
				: `Try the ${stronger.name} lineup`,
	};
}

function nextStronger(
	pick: OutcomeAutoPick,
	lineups: readonly Lineup[],
	agents: RosterAgent[],
): Lineup | undefined {
	let best: { lineup: Lineup; first: AgentPick } | undefined;
	for (const lineup of lineups) {
		const first = lineup.picks[0];
		if (
			first === undefined ||
			lineup.id === pick.lineup ||
			!higher(agents, pick, first)
		) {
			continue;
		}
		const candidate = {
			...pick,
			model: first.model ?? null,
			effort: first.effort ?? null,
		};
		if (best === undefined || higher(agents, candidate, best.first)) {
			best = { lineup, first };
		}
	}
	return best?.lineup;
}

function startsWith(lineup: Lineup, pick: OutcomeAutoPick): boolean {
	const first = lineup.picks[0];
	return (
		first?.agent === pick.agent &&
		(first.model ?? null) === pick.model &&
		(first.effort ?? null) === pick.effort
	);
}

function pickName(pick: OutcomeAutoPick, agents: RosterAgent[]): string {
	const agent = [...agents, ...DEFAULT_AGENTS].find(
		(each) => each.id === pick.agent,
	);
	const model =
		agent?.models.find((each) => each.id === pick.model)?.name ?? pick.model;
	const choice = model ?? agent?.name ?? pick.agent;
	return pick.effort === null ? choice : `${choice} at ${pick.effort} effort`;
}
