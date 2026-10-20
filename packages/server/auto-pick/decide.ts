import type { Limit, Setting } from "../conversations";
import type { AgentPick, RosterAgent } from "../models";
import {
	CONTEXT_CLASSES,
	DEPTHS,
	type DepthId,
	KINDS,
	type KindId,
	type TaskClass,
} from "./classes";
import type { Classification } from "./classify";
import { ANY, type AutoPickRules, DEFAULT_PACE, ruleLabel } from "./rules";

/** Whom Auto pick starts on a task, and why. */
export interface AutoPickDecision {
	pick: AgentPick;
	/** The index in the rules of the rule that matched. */
	rule: number;
	/** The kind the task was taken for; null when the judge was not sure of any. */
	kind: KindId | null;
	/** The depth the task was taken for; null when the judge was not sure of any. */
	depth: DepthId | null;
	/** Why, in short lines the page can show, the pick first. */
	reasons: string[];
}

/** What a decision reads besides the task's classification. */
export interface DecideContext {
	/** The person's mapping, `AutoPickStore.rules()`. */
	rules: AutoPickRules;
	/** The roster, `Roster.agents()`. */
	agents: RosterAgent[];
	/**
	 * The ids of the agents splates can start here, `Conversations.agents`: a
	 * pick of any other is passed over, so the decision names one that runs.
	 */
	runnable: readonly string[];
	/** Each agent's plan limits, `Limits.all()`. */
	limits: Record<string, Limit[]>;
	/** What each agent that ran on this machine offers, `Offered.all()`. */
	offered: Record<string, Setting[]>;
	now: Date;
}

/** What `decide` reads. */
export interface DecideInput extends DecideContext {
	/** What the judge said of the task. */
	classification: Classification;
}

/** What `decideWithout` reads. */
export interface DecideWithoutInput extends DecideContext {
	/** Why there is no classification, as `classify` said. */
	reason: string;
}

/**
 * Turns a classification into a pick: the likeliest kind and depth, each
 * when the judge is sure enough of it, find the first rule that matches both,
 * and the first of its picks whose agent has plan left, used no faster than
 * its windows go by, wins.
 */
export function decide(input: DecideInput): AutoPickDecision {
	const { threshold } = input.rules;
	const kind = likeliest(KINDS, input.classification.kinds, threshold);
	const depth = likeliest(DEPTHS, input.classification.depth, threshold);
	const decision = choose(
		input,
		kind.id,
		depth.id,
		`judged: ${kind.said}, ${depth.said}`,
	);
	for (const [group, classes] of Object.entries(CONTEXT_CLASSES)) {
		const answers = input.classification[group as keyof typeof CONTEXT_CLASSES];
		if (answers !== undefined) {
			decision.reasons.push(
				`${group}: ${classes.map((each) => `${each.label} ${Math.round(((answers as Record<string, number>)[each.id] ?? 0.5) * 100)}%`).join(", ")}`,
			);
		}
	}
	return decision;
}

/**
 * A pick for a task the judge could not classify: the first rule that takes
 * any kind and any depth, saying why the judge was not asked.
 */
export function decideWithout(input: DecideWithoutInput): AutoPickDecision {
	return choose(input, null, null, input.reason);
}

/** The first rule matching `kind` and `depth`, and the first of its picks with plan left. */
function choose(
	input: DecideContext,
	kind: KindId | null,
	depth: DepthId | null,
	judged: string,
): AutoPickDecision {
	const index = input.rules.rules.findIndex(
		(each) =>
			(each.kind === ANY || each.kind === kind) &&
			(each.depth === ANY || each.depth === depth),
	);
	const matched = input.rules.rules[index];
	if (matched === undefined) {
		// Checked rules end on `* *`, so only rules no check saw land here.
		throw new Error("no Auto pick rule matches: the last must be * *");
	}
	const reasons = [judged, `rule ${index + 1}: ${ruleLabel(matched)}`];

	const pace = input.rules.pace ?? DEFAULT_PACE;
	const usable = matched.picks.flatMap((pick) => {
		const agent = input.agents.find((each) => each.id === pick.agent);
		if (agent === undefined) {
			reasons.push(`passed over ${pick.agent}: not on the roster`);
			return [];
		}
		if (!input.runnable.includes(agent.id)) {
			reasons.push(`passed over ${agent.name}: can't run here`);
			return [];
		}
		const model = modelOf(agent, pick.model);
		if (model === null) {
			reasons.push(
				`passed over ${agent.name}: no model '${pick.model}' on the roster`,
			);
			return [];
		}
		const { model: _, ...rest } = pick;
		const limits = input.limits[agent.id] ?? [];
		return [
			{
				pick: model === undefined ? rest : { ...rest, model },
				agent,
				pressure: pressed(limits, input.now),
				fast: pace.on ? fastest(limits, input.now, pace.slack) : undefined,
			},
		];
	});

	const left = usable.filter((each) => (each.pressure?.used ?? 0) < pace.spent);
	const paced = left.find((each) => each.fast === undefined);
	let chosen = paced ?? left[0];
	for (const each of usable.slice(
		0,
		chosen === undefined ? 0 : usable.indexOf(chosen),
	)) {
		reasons.push(
			`passed over ${each.agent.name}: ${
				(each.pressure?.used ?? 0) < pace.spent
					? ahead(each.fast)
					: plan(each.pressure)
			}`,
		);
	}
	if (chosen !== undefined && paced === undefined) {
		reasons.push(
			`every pick with plan left is ahead of pace, so the first: ${chosen.agent.name}, ${ahead(chosen.fast)}`,
		);
	}
	if (chosen === undefined) {
		chosen = [...usable].sort(
			(left, right) => (left.pressure?.used ?? 0) - (right.pressure?.used ?? 0),
		)[0];
		if (chosen !== undefined) {
			reasons.push(
				`every pick is past ${Math.round(pace.spent * 100)}% of a plan, so the least used: ${chosen.agent.name}, ${plan(chosen.pressure)}`,
			);
		}
	}
	if (chosen === undefined) {
		const first = input.agents.find((each) => input.runnable.includes(each.id));
		if (first === undefined) {
			throw new Error("the roster lists no agent splates can run here");
		}
		reasons.push(
			`no pick of rule ${index + 1} can run here, so ${first.name} on its default`,
		);
		chosen = {
			pick: { agent: first.id },
			agent: first,
			pressure: undefined,
			fast: undefined,
		};
	}

	const pick = withEffort(
		chosen.pick,
		chosen.agent,
		input.offered[chosen.agent.id],
		reasons,
	);
	reasons.unshift(headline(pick, chosen.agent));
	return { pick, rule: index, kind, depth, reasons };
}

/** The likeliest class, when the judge is at least `threshold` sure of it, and how it reads. */
function likeliest<Id extends string>(
	classes: readonly TaskClass<Id>[],
	answers: Record<Id, number>,
	threshold: number,
): { id: Id | null; said: string } {
	const best = classes.reduce<TaskClass<Id> | undefined>(
		(most, each) =>
			most === undefined || answers[each.id] > answers[most.id] ? each : most,
		undefined,
	);
	if (best === undefined) {
		return { id: null, said: "none" };
	}
	const said = `${best.label} ${Math.round(answers[best.id] * 100)}%`;
	return answers[best.id] >= threshold
		? { id: best.id, said }
		: { id: null, said: `unsure (${said})` };
}

/**
 * `wanted` as the roster's id among `agent`'s models, by its id or name in any
 * case; undefined for the agent's default, and null for one it does not list.
 * An agent whose models the roster leaves out takes the model as given.
 */
function modelOf(
	agent: RosterAgent,
	wanted: string | undefined,
): string | undefined | null {
	if (wanted === undefined || agent.models.length === 0) {
		return wanted;
	}
	const lower = wanted.toLowerCase();
	return (
		agent.models.find(
			(each) =>
				each.id === wanted ||
				each.id.toLowerCase() === lower ||
				each.name.toLowerCase() === lower,
		)?.id ?? null
	);
}

/**
 * `pick` with its effort as the agent's `thought_level` setting takes it; with
 * none, and a reason, when the agent offers no such level. An agent never
 * started here has offered nothing yet, so it keeps the effort as given.
 */
function withEffort(
	pick: AgentPick,
	agent: RosterAgent,
	offered: Setting[] | undefined,
	reasons: string[],
): AgentPick {
	if (pick.effort === undefined || offered === undefined) {
		return pick;
	}
	const { effort, ...rest } = pick;
	const setting = offered.find((each) => each.category === "thought_level");
	if (setting === undefined) {
		reasons.push(`${agent.name} offers no thinking level, so its own`);
		return rest;
	}
	const lower = effort.toLowerCase();
	const level = setting.options.find(
		(each) =>
			each.value.toLowerCase() === lower || each.name.toLowerCase() === lower,
	);
	if (level === undefined) {
		reasons.push(`${agent.name} offers no ${effort} thinking, so its own`);
		return rest;
	}
	return { ...rest, effort: level.value };
}

/** The pick in words: `Sonnet 5.5, low effort`. */
function headline(pick: AgentPick, agent: RosterAgent): string {
	const model =
		pick.model === undefined
			? `${agent.name} on its default model`
			: (agent.models.find((each) => each.id === pick.model)?.name ??
				`${agent.name} ${pick.model}`);
	return pick.effort === undefined ? model : `${model}, ${pick.effort} effort`;
}

/** The most used of an agent's plan windows that have not reset yet. */
function pressed(
	limits: Limit[],
	now: Date,
): { used: number; window: string } | undefined {
	return limits
		.filter((each) => !(Date.parse(each.resets) <= now.getTime()))
		.reduce<{ used: number; window: string } | undefined>(
			(most, each) =>
				most === undefined || each.used > most.used
					? { used: each.used, window: each.window }
					: most,
			undefined,
		);
}

/** How far into a window its use is, and how far into its time. */
interface Overrun {
	window: string;
	used: number;
	/** The share of the window's time gone by when `used` was read. */
	elapsed: number;
}

/**
 * The window an agent uses furthest ahead of its time, more than `slack` of
 * it ahead; undefined when none is. A window whose length its name does not
 * give, or that has reset, is not judged.
 */
function fastest(
	limits: Limit[],
	now: Date,
	slack: number,
): Overrun | undefined {
	return limits
		.flatMap((each) => {
			const length = lengthOf(each.window);
			const resets = Date.parse(each.resets);
			if (length === null || !(resets > now.getTime())) {
				return [];
			}
			// `used` was read at `at`, so its pace is the window's time gone by then.
			const read = each.at === null ? now.getTime() : Date.parse(each.at);
			const elapsed = Math.min(1, Math.max(0, 1 - (resets - read) / length));
			return each.used > elapsed + slack
				? [{ window: each.window, used: each.used, elapsed }]
				: [];
		})
		.reduce<Overrun | undefined>(
			(most, each) =>
				most === undefined ||
				each.used - each.elapsed > most.used - most.elapsed
					? each
					: most,
			undefined,
		);
}

const COUNTS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	twelve: 12,
	thirty: 30,
};

const UNITS: Record<string, number> = {
	minute: 60_000,
	hour: 3_600_000,
	day: 86_400_000,
	week: 604_800_000,
};

/**
 * A window's length in milliseconds from its name, as Claude names them
 * (`five_hour`, `seven_day_opus`) and Codex's that splates names
 * (`300_minutes`); null for a name that gives none.
 */
function lengthOf(window: string): number | null {
	const [count, unit] = window.toLowerCase().split("_");
	const times = /^\d+$/.test(count ?? "") ? Number(count) : COUNTS[count ?? ""];
	const each = UNITS[unit?.replace(/s$/, "") ?? ""];
	return times === undefined || each === undefined || times === 0
		? null
		: times * each;
}

/** An agent's pace in words: `60% of five_hour used, 20% of it gone`. */
function ahead(pace: Overrun | undefined): string {
	return pace === undefined
		? "within its pace"
		: `${Math.round(pace.used * 100)}% of ${pace.window} used, ${Math.round(pace.elapsed * 100)}% of it gone`;
}

/** An agent's plan pressure in words: `85% of five_hour used`. */
function plan(most: { used: number; window: string } | undefined): string {
	return most === undefined
		? "no plan limits"
		: `${Math.round(most.used * 100)}% of ${most.window} used`;
}
