import type { AutopickRules } from "../autopick";
import { DEFAULT_RULES } from "../autopick/browser";
import { higher, pickOf } from "../autopick/scoring";
import type { AutopickSet, Pairing } from "../conversations";
import { DEFAULT_AGENTS, type RosterAgent } from "../models";
import type { Event } from "../records";
import {
	compareHoldout,
	type HoldoutComparison,
	type HoldoutSide,
} from "./holdout-comparison";
import type { ModelProvider } from "./model-provider";
import type { Outcome, OutcomeAutopick, OutcomeLift } from "./outcomes";
import { suggestedChange } from "./scorecard-suggestions";
import { PERIODS, type PeriodId } from "./stats";

export const SCORECARD_MIN_TASKS = 10;

export type PickVerdict = "weak" | "strong" | "fine" | "sparse";
export type PickSignal = "lifts" | "trouble" | "overrides" | "cost" | "holdout";

export interface ScorecardRow {
	kind: string | null;
	depth: string | null;
	lineup: string | null;
	tasks: number;
	dollarsPerTask: number | null;
	turns: number | null;
	lines: number | null;
	troubleRate: number | null;
	correctionRate: number | null;
	liftRate: number;
	lifts: number;
	/** Whether most lifts came from tasks the holdout started a step easier. */
	liftedInHoldout: boolean;
	troubledWithoutLift: number;
	overridesUp: number;
	overridesDown: number;
	overridesUnranked: number;
	verdict: PickVerdict;
	signals: PickSignal[];
	comparison: { cost: number; nextCost: number; ratio: number } | null;
	/** The cell's tasks the holdout held back from this lineup, beside its regular ones; null when none were. */
	holdout: HoldoutComparison | null;
	suggestion: string | null;
	/** The provider when the suggestion names a model. */
	suggestionProvider?: ModelProvider;
}

type Picked = Outcome & { autoPick: OutcomeAutopick };

type Correction = Event & { action: "notes attached"; corrects: number };
type Corrections = ReadonlyMap<string, readonly Correction[]>;

/** One score per recorded cell and lineup, with review candidates first. */
export function scorecard(
	outcomes: readonly Picked[],
	{
		agents,
		eventsByProject = new Map(),
		rules = DEFAULT_RULES,
	}: {
		agents: RosterAgent[];
		eventsByProject?: ReadonlyMap<string, readonly Event[]>;
		rules?: AutopickRules | null;
	},
): ScorecardRow[] {
	const corrections = new Map<string, Correction[]>();
	for (const [project, events] of eventsByProject) {
		for (const event of events) {
			if (
				event.action === "notes attached" &&
				event.reason === null &&
				event.conversation !== null &&
				event.afterReply !== false &&
				typeof event.corrects === "number" &&
				event.corrects >= 0 &&
				event.corrects <= 1
			) {
				const key = JSON.stringify([project, event.conversation]);
				const list = corrections.get(key) ?? [];
				list.push(event as Correction);
				corrections.set(key, list);
			}
		}
	}
	const cells = Map.groupBy(outcomes, ({ autoPick: { kind, depth } }) =>
		JSON.stringify([kind, depth]),
	);
	return [...cells.values()]
		.flatMap((cell) => {
			const cohorts = Map.groupBy(cell, ({ autoPick }) => pickKey(autoPick));
			return [
				...Map.groupBy(cell, ({ autoPick }) => autoPick.lineup).values(),
			].map((group) =>
				summarizePicks(
					group,
					cell.filter(
						({ autoPick }) =>
							autoPick.holdout !== undefined &&
							autoPick.holdout.lineup === group[0]?.autoPick.lineup,
					),
					cohorts,
					{ agents, corrections, rules },
				),
			);
		})
		.toSorted(
			(left, right) =>
				verdictOrder[left.verdict] - verdictOrder[right.verdict] ||
				right.tasks - left.tasks,
		);
}

export function scorecardWindow(
	outcomes: readonly Outcome[],
	period: PeriodId | { span: number },
	now: number,
): { history: Outcome[]; picks: Picked[] } {
	const span =
		typeof period === "object"
			? period.span
			: period === "all"
				? Infinity
				: PERIODS[period].span;
	const since = now - span;
	const history = outcomes.filter((outcome) => {
		const ended = Date.parse(outcome.endedAt);
		return ended >= since && ended <= now;
	});
	return {
		history,
		picks: history.filter(
			(outcome): outcome is Picked => outcome.autoPick != null,
		),
	};
}

const verdictOrder: Record<PickVerdict, number> = {
	weak: 0,
	strong: 1,
	fine: 2,
	sparse: 3,
};

function summarizePicks(
	group: Picked[],
	heldOut: Picked[],
	cohorts: ReadonlyMap<string, Picked[]>,
	{
		agents,
		corrections,
		rules,
	}: {
		agents: RosterAgent[];
		corrections: Corrections;
		rules: AutopickRules | null;
	},
): ScorecardRow {
	const first = group[0] as Picked; // Map.groupBy creates only nonempty groups.
	const { kind, depth, lineup } = first.autoPick;
	const tasks = group.length;
	const troubleKnown = group.filter(
		(outcome) =>
			outcome.findings !== undefined || outcome.removedFor === "redo",
	);
	const trouble = troubleKnown.filter(troubled);
	const lifted = new Set(
		group.filter((outcome) => firstLift(outcome, agents) !== undefined),
	);
	const lifts = lifted.size;
	const directions = group.map((outcome) => overridden(outcome, agents));
	const overridesUp = directions.filter(
		(direction) => direction === "up",
	).length;
	const overridesDown = directions.filter(
		(direction) => direction === "down",
	).length;
	const overridesUnranked = directions.filter(
		(direction) => direction === "unranked",
	).length;
	const judged = group.map((outcome) => correctionsOf(outcome, corrections));
	const correctionRate = average(judged.flat());
	const troubleRate = rate(trouble.length, troubleKnown.length);
	const turnCounts = group.flatMap(({ turns }) =>
		turns === undefined ? [] : [turns],
	);
	const turns = average(turnCounts);
	const troubledWithoutLift = trouble.filter(
		(outcome) => !lifted.has(outcome),
	).length;
	const signals: PickSignal[] = [];
	let verdict: PickVerdict = "sparse";
	let comparison: CostComparison | null = null;
	const dominant = dominantCohort(group);
	const liftedInHoldout =
		[...lifted].filter(({ autoPick }) => autoPick.holdout !== undefined)
			.length >
		lifts / 2;
	if (tasks >= SCORECARD_MIN_TASKS) {
		if (lifts / tasks >= 0.25) {
			signals.push("lifts");
		}
		if (
			troubleKnown.length >= SCORECARD_MIN_TASKS &&
			troubledWithoutLift / troubleKnown.length >= 0.3
		) {
			signals.push("trouble");
		}
		if (overridesUp / tasks >= 0.2) {
			signals.push("overrides");
		}
		verdict = signals.length === 0 ? "fine" : "weak";
		if (
			verdict === "fine" &&
			troubleKnown.length >= SCORECARD_MIN_TASKS &&
			(troubleRate ?? 1) <= 0.1 &&
			judged.filter((scores) => scores.length > 0).length >=
				SCORECARD_MIN_TASKS &&
			(correctionRate ?? 1) <= 0.1 &&
			turnCounts.length >= SCORECARD_MIN_TASKS &&
			(turns ?? Infinity) <= 3
		) {
			comparison = compareCost(dominant, tasks, cohorts, agents);
			if (comparison !== null && comparison.figures.ratio >= 1.75) {
				verdict = "strong";
				signals.push("cost");
			}
		}
	}
	const holdout =
		heldOut.length === 0
			? null
			: compareHoldout({
					easier: mostCommon(heldOut.map(({ autoPick }) => autoPick.lineup)),
					heldOut: holdoutSide(heldOut, agents),
					regular: holdoutSide(
						group.filter(({ autoPick }) => autoPick.holdout === undefined),
						agents,
					),
				});
	if (holdout?.overpowered === true && verdict !== "weak") {
		verdict = "strong";
		signals.push("holdout");
	}
	return {
		kind,
		depth,
		lineup,
		tasks,
		verdict,
		signals,
		comparison: comparison?.figures ?? null,
		holdout,
		...suggestedChange({
			signals,
			pick: dominant[0]?.autoPick ?? first.autoPick,
			cheaper: comparison?.pick ?? null,
			easier: holdout?.easier ?? null,
			liftedInHoldout,
			agents,
			rules,
		}),
		dollarsPerTask: average(group.flatMap(dollars)),
		turns,
		lines: average(
			group.flatMap(({ size }) =>
				size === undefined ? [] : [size.added + size.removed],
			),
		),
		troubleRate,
		correctionRate,
		liftRate: lifts / tasks,
		lifts,
		liftedInHoldout,
		troubledWithoutLift,
		overridesUp,
		overridesDown,
		overridesUnranked,
	};
}

/** How one side of the holdout went: a task troubled, lifted or overridden up is a problem. */
function holdoutSide(outcomes: Picked[], agents: RosterAgent[]): HoldoutSide {
	const problems = outcomes.filter(
		(outcome) =>
			troubled(outcome) ||
			firstLift(outcome, agents) !== undefined ||
			overridden(outcome, agents) === "up",
	).length;
	return {
		tasks: outcomes.length,
		problems,
		problemRate: rate(problems, outcomes.length),
		dollarsPerTask: average(outcomes.flatMap(dollars)),
	};
}

function mostCommon<T>(values: readonly T[]): T | null {
	const counts = new Map<T, number>();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return (
		[...counts].toSorted((left, right) => right[1] - left[1])[0]?.[0] ?? null
	);
}

const TROUBLE = new Set(["churn", "retried", "gate", "stopped", "interrupted"]);

function troubled(outcome: Outcome): boolean {
	return (
		outcome.removedFor === "redo" ||
		outcome.findings?.some(({ kind }) => TROUBLE.has(kind)) === true
	);
}

/** Switching Autopick on can also move down, unlike an ordinary lift. */
function firstLift(
	{ autoPick }: Picked,
	agents: RosterAgent[],
): OutcomeLift | undefined {
	return autoPick.lifts.find(
		(lift) =>
			lift.reason !== "switched" ||
			higher(agents, lift.from ?? autoPick, pickOf(lift.to)),
	);
}

function correctionsOf(outcome: Picked, corrections: Corrections): number[] {
	const key = JSON.stringify([outcome.project, outcome.conversation]);
	return (corrections.get(key) ?? []).flatMap((event) =>
		(event.task === null || event.task === outcome.task) &&
		event.at >= outcome.startedAt &&
		event.at <= outcome.endedAt
			? [event.corrects]
			: [],
	);
}

function overridden(
	outcome: Picked,
	agents: RosterAgent[],
): "up" | "down" | "unranked" | null {
	const overrides = outcome.overrides ?? [];
	if (overrides.length === 0) {
		return null;
	}
	const from = overrides[0]?.from;
	const to = overrides.at(-1)?.result;
	if (from === undefined || to === undefined) {
		return "unranked";
	}
	const was = pairingPick(from, outcome.autoPick, agents);
	const next = pairingPick(to, outcome.autoPick, agents);
	if (higher(agents, was, pickOf(next))) {
		return "up";
	}
	if (higher(agents, next, pickOf(was))) {
		return "down";
	}
	return pickKey(was) === pickKey(next) ? null : "unranked";
}

function pairingPick(
	pairing: Pairing,
	picked: AutopickSet,
	agents: RosterAgent[],
): AutopickSet {
	const name = pairing.model?.toLowerCase();
	const agent = picked.agent;
	const model = [
		...(agents.find((each) => each.id === agent)?.models ?? []),
		...(DEFAULT_AGENTS.find((each) => each.id === agent)?.models ?? []),
	].find(
		(each) =>
			each.id.toLowerCase() === name || each.name.toLowerCase() === name,
	);
	const effort =
		pairing.effort?.toLowerCase().replace(/^extra[ -]high$/, "xhigh") ?? null;
	return { ...picked, model: model?.id ?? pairing.model, effort };
}

function pickKey({ agent, model, effort }: AutopickSet): string {
	return JSON.stringify([agent, model, effort]);
}

/** The initial pick used most often in a cell and lineup. */
function dominantCohort(group: Picked[]): Picked[] {
	return (
		[
			...Map.groupBy(group, ({ autoPick }) => pickKey(autoPick)).values(),
		].toSorted((left, right) => right.length - left.length)[0] ?? []
	);
}

interface CostComparison {
	pick: OutcomeAutopick;
	figures: NonNullable<ScorecardRow["comparison"]>;
}

/** Compare the row's dominant initial pick to its nearest observed lower pick in the same cell. */
function compareCost(
	dominant: Picked[],
	tasks: number,
	cohorts: ReadonlyMap<string, Picked[]>,
	agents: RosterAgent[],
): CostComparison | null {
	const selected = dominant?.[0]?.autoPick;
	if (selected === undefined || dominant.length <= tasks / 2) {
		return null;
	}
	const costs = dominant.flatMap(dollars);
	if (costs.length < SCORECARD_MIN_TASKS) {
		return null;
	}
	let lower: Picked[] | undefined;
	for (const cohort of cohorts.values()) {
		const candidate = cohort[0]?.autoPick;
		const best = lower?.[0]?.autoPick;
		if (
			candidate !== undefined &&
			higher(agents, candidate, pickOf(selected)) &&
			(best === undefined || higher(agents, best, pickOf(candidate)))
		) {
			lower = cohort;
		}
	}
	const next = lower?.[0]?.autoPick;
	const lowerCosts = lower?.flatMap(dollars) ?? [];
	const cost = average(costs);
	const nextCost = average(lowerCosts);
	return next === undefined ||
		lowerCosts.length < SCORECARD_MIN_TASKS ||
		cost === null ||
		nextCost === null ||
		nextCost <= 0
		? null
		: { pick: next, figures: { cost, nextCost, ratio: cost / nextCost } };
}

function dollars({ usage }: Outcome): number[] {
	const cost = usage?.cost;
	return cost?.currency === "USD" &&
		Number.isFinite(cost.amount) &&
		cost.amount >= 0
		? [cost.amount]
		: [];
}

function average(values: readonly number[]): number | null {
	return rate(
		values.reduce((sum, value) => sum + value, 0),
		values.length,
	);
}

function rate(count: number, total: number): number | null {
	return total === 0 ? null : count / total;
}
