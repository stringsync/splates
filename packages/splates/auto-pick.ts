import type { Credentials } from "webappwiz/creds";
import { Duration } from "webappwiz/time";
import { Clef } from "./clef";
import type { Limit, Setting } from "./conversations";
import { Jev } from "./jev";
import { modelOption } from "./models";
import {
	type AgentPick,
	type ModelTraits,
	type RosterAgent,
	type Speed,
	traitsOf,
} from "./roster";
import type { Judge, Noul } from "./system-one";

export type { Judge, Judgment } from "./system-one";

/**
 * Who reads a new conversation's first prompt, and how hard it thinks: a
 * probe, which can hand the work on once it has read the code.
 */
export interface AutoPick extends AgentPick {
	/** The thinking level, as the agent's `thought_level` setting takes it; none for its default. */
	effort?: string;
	/** Why, in short lines the page can show. */
	reasons: string[];
}

/** What `pick` reads. */
export interface PickInput {
	/** The conversation's first prompt. */
	prompt: string;
	/** The roster, `Roster.agents()`. */
	agents: RosterAgent[];
	/** What each agent that ran on this machine offers, `Offered.all()`. */
	offered: Record<string, Setting[]>;
	/** Each agent's plan limits, `Limits.all()`. */
	limits: Record<string, Limit[]>;
	/** The decision model; null when no cred for one is kept. */
	judge: Judge | null;
	now: Date;
	/** How long the judge may take before the default weight stands in. */
	timeout?: Duration;
	signal?: AbortSignal;
}

/** The creds each judge reads, named as `wiz creds` names them. */
export const JUDGE_CREDS = {
	jev: ["TYPESAFE_API_KEY"],
	clef: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
} as const;

/**
 * The judge `pick` asks: Jev when its key is kept, else Clef when its
 * account is; null when neither is, so `pick` falls back to the default weight.
 */
export async function judgeFrom(
	credentials: Pick<Credentials, "get">,
): Promise<Judge | null> {
	const typesafe = await credentials.get("TYPESAFE_API_KEY");
	if (typesafe) {
		return new Jev(typesafe);
	}
	const id = await credentials.get("CLOUDFLARE_ACCOUNT_ID");
	const token = await credentials.get("CLOUDFLARE_API_TOKEN");
	return id && token ? new Clef(id, token) : null;
}

/** The weakest and strongest tiers the roster ranks. */
const TIERS = { least: 1, most: 4 } as const;

/** What a prompt needs when no judge answers: Claude's default weight. */
const DEFAULT_TIER = 3;

/** How long a pick waits on the judge. */
const DEFAULT_TIMEOUT = Duration.secs(5);

/** Past this share of any plan window, picks go a tier lighter on that agent. */
const TIGHT = 0.8;

/** Past this share, an agent is passed over while another is left. */
const SPENT = 0.95;

/** Below this confidence in the judge's answers, think one level harder. */
const UNSURE = 0.4;

/**
 * The prompt the judge reads, at most this long: the head says how big the
 * work is, and a provider cuts a long state short without saying.
 */
const PROMPT_CHARS = 4000;

/** The thinking levels a pick chooses among, from the least. */
const LEVELS = ["low", "medium", "high"] as const;

/** Where in `LEVELS` each tier starts, from the weakest. */
const TIER_LEVEL = [0, 0, 1, 2];

/** What the judge is asked of the prompt, by id, with how a yes reads in a reason. */
export const QUESTIONS: Record<string, Noul & { yes: string }> = {
	lookup: {
		type: "noul",
		instructions:
			"Is `prompt` a quick question or lookup, answerable in a few minutes without changing code?",
		yes: "a quick question",
	},
	mechanical: {
		type: "noul",
		instructions:
			"Does `prompt` ask for a mechanical, well-specified change, saying what to change and how?",
		yes: "a well-specified edit",
	},
	design: {
		type: "noul",
		instructions:
			"Does `prompt` need a design decision: choosing between approaches, shaping an API or data model, or weighing trade-offs?",
		yes: "a design decision",
	},
	broad: {
		type: "noul",
		instructions:
			"Will the work `prompt` asks for likely touch many files or several parts of a system?",
		yes: "many files",
	},
	open: {
		type: "noul",
		instructions:
			"Is `prompt` open-ended or research-like, with much to investigate before the work is clear?",
		yes: "open-ended",
	},
};

/**
 * The tier a prompt needs, from the judge's answers: light work with none of
 * design, breadth or open-endedness takes the weakest, all three the
 * strongest. A question left unanswered counts as a coin toss.
 */
export function tierFor(answers: Map<string, number>): number {
	const yes = (id: string) => (answers.get(id) ?? 0.5) >= 0.5;
	const hard = ["design", "broad", "open"].filter(yes);
	if (hard.length === 0) {
		return yes("lookup") || yes("mechanical") ? 1 : 2;
	}
	if (hard.length === 1 && hard[0] === "broad" && yes("mechanical")) {
		return 2;
	}
	return hard.length === 3 ? TIERS.most : 3;
}

/**
 * Picks the agent, model and thinking level for `input.prompt`: the judge
 * says what the prompt needs, and code picks the cheapest, fastest model that
 * meets it among those that can start here, a tier lighter where a plan is
 * nearly used up. With no judge, or one that fails or is slow, the default
 * weight stands in and the reasons say so.
 */
export async function pick(input: PickInput): Promise<AutoPick> {
	const reasons: string[] = [];
	const judged = await judgeTier(input, reasons);
	const tier = judged?.tier ?? DEFAULT_TIER;
	reasons.push(`needs tier ${tier} of ${TIERS.most}`);

	const ran = input.agents.filter((agent) => input.offered[agent.id]);
	if (ran.length === 0) {
		reasons.push("no agent has run on this machine yet, so any on the roster");
	}
	let agents = ran.length === 0 ? input.agents : ran;
	const pressure = new Map(
		agents.map((agent) => [
			agent.id,
			pressed(input.limits[agent.id] ?? [], input.now),
		]),
	);
	const fresh = agents.filter(
		(agent) => (pressure.get(agent.id)?.used ?? 0) < SPENT,
	);
	if (fresh.length > 0 && fresh.length < agents.length) {
		for (const agent of agents.filter((each) => !fresh.includes(each))) {
			reasons.push(`passed over ${agent.name}: ${plan(pressure, agent.id)}`);
		}
		agents = fresh;
	}

	const candidates = agents.flatMap((agent, order) =>
		agent.models.flatMap((model) => {
			const settings = input.offered[agent.id] ?? [];
			const offersModels = settings.some(
				(each) => each.category === "model" || each.id === "model",
			);
			if (offersModels && modelOption(settings, model.id, true) === null) {
				return [];
			}
			const traits = traitsOf(input.agents, {
				agent: agent.id,
				model: model.id,
			});
			return traits === undefined
				? []
				: [{ agent, model: model.id, name: model.name, traits, order }];
		}),
	);
	const best = choose(candidates, (agent) => {
		const tight = (pressure.get(agent)?.used ?? 0) >= TIGHT;
		return tight ? Math.max(TIERS.least, tier - 1) : tier;
	});
	if (best === undefined) {
		const first = input.agents[0];
		if (first === undefined) {
			throw new Error("the roster lists no agents to pick from");
		}
		reasons.push(`no ranked model to pick, so ${first.name} on its default`);
		return { agent: first.id, reasons };
	}
	if ((pressure.get(best.agent.id)?.used ?? 0) >= TIGHT) {
		reasons.push(
			`a tier lighter on ${best.agent.name}: ${plan(pressure, best.agent.id)}`,
		);
	}

	const effort =
		judged === undefined
			? undefined
			: thinking(
					input.offered[best.agent.id] ?? [],
					tier,
					judged.sure,
					reasons,
				);
	reasons.unshift(
		`${best.name}${effort === undefined ? "" : `, ${effort} effort`}`,
	);
	return {
		agent: best.agent.id,
		model: best.model,
		...(effort === undefined ? {} : { effort }),
		reasons,
	};
}

/**
 * Asks the judge what the prompt needs, saying in `reasons` what it found;
 * undefined, with the reason, when there is no judge or it gives no answer in time.
 */
async function judgeTier(
	input: PickInput,
	reasons: string[],
): Promise<{ tier: number; sure: number } | undefined> {
	if (input.judge === null) {
		reasons.push(
			`no judge: keep ${JUDGE_CREDS.jev.join(", ")} for Jev, or ${JUDGE_CREDS.clef.join(" and ")} for Clef`,
		);
		return undefined;
	}
	const timeout = input.timeout ?? DEFAULT_TIMEOUT;
	const signals = [AbortSignal.timeout(timeout.ms)];
	if (input.signal !== undefined) {
		signals.push(input.signal);
	}
	const signal = AbortSignal.any(signals);
	try {
		const verdict = await Promise.race([
			input.judge.judge(
				{
					state: { prompt: input.prompt.slice(0, PROMPT_CHARS) },
					questions: Object.fromEntries(
						Object.entries(QUESTIONS).map(([id, { yes: _, ...noul }]) => [
							id,
							noul,
						]),
					),
				},
				{ signal },
			),
			aborted(signal),
		]);
		const said = Object.entries(QUESTIONS)
			.filter(([id]) => (verdict.answers.get(id) ?? 0) >= 0.5)
			.map(([, question]) => question.yes);
		reasons.push(
			said.length === 0
				? "judged: none of the signs"
				: `judged: ${said.join(", ")}`,
		);
		return {
			tier: tierFor(verdict.answers),
			sure: confidence(verdict.answers),
		};
	} catch (error) {
		if (input.signal?.aborted) {
			throw input.signal.reason;
		}
		reasons.push(
			signal.aborted
				? `the judge took over ${timeout.ms / 1000}s, so the default weight`
				: `the judge failed (${error instanceof Error ? error.message : String(error)}), so the default weight`,
		);
		return undefined;
	}
}

/** Rejects once `signal` aborts, for a judge that does not heed it. */
function aborted(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
		}
		signal.addEventListener("abort", () => reject(signal.reason), {
			once: true,
		});
	});
}

/** How far, on average, the answers sit from a coin toss, 0 to 1. */
function confidence(answers: Map<string, number>): number {
	const ids = Object.keys(QUESTIONS);
	const total = ids.reduce(
		(sum, id) => sum + Math.abs((answers.get(id) ?? 0.5) - 0.5) * 2,
		0,
	);
	return total / ids.length;
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

/** An agent's plan pressure in words: `85% of five_hour used`. */
function plan(
	pressure: Map<string, { used: number; window: string } | undefined>,
	agent: string,
): string {
	const most = pressure.get(agent);
	return most === undefined
		? "no plan limits"
		: `${Math.round(most.used * 100)}% of ${most.window} used`;
}

const SPEED: Record<Speed, number> = { fast: 0, medium: 1, slow: 2 };

/**
 * The cheapest, then fastest, then weakest model that meets the tier its
 * agent needs, then the roster's order; when none meets it, the strongest.
 */
function choose<
	T extends { agent: RosterAgent; traits: ModelTraits; order: number },
>(candidates: T[], need: (agent: string) => number): T | undefined {
	const meets = candidates.filter(
		(each) => each.traits.tier >= need(each.agent.id),
	);
	const cheapest = (left: T, right: T) =>
		left.traits.costRank - right.traits.costRank ||
		SPEED[left.traits.speed] - SPEED[right.traits.speed] ||
		left.traits.tier - right.traits.tier ||
		left.order - right.order;
	if (meets.length > 0) {
		return meets.sort(cheapest)[0];
	}
	return [...candidates].sort(
		(left, right) =>
			right.traits.tier - left.traits.tier || cheapest(left, right),
	)[0];
}

/**
 * The thinking level for `tier`, a level higher when the judge was unsure,
 * as the agent's `thought_level` setting offers it; undefined when it offers
 * none, or not that level.
 */
function thinking(
	settings: Setting[],
	tier: number,
	sure: number,
	reasons: string[],
): string | undefined {
	const setting = settings.find((each) => each.category === "thought_level");
	if (setting === undefined) {
		return undefined;
	}
	let level = TIER_LEVEL[tier - TIERS.least] ?? 0;
	if (sure < UNSURE && level < LEVELS.length - 1) {
		level += 1;
		reasons.push("the judge was unsure, so one thinking level higher");
	}
	const effort = LEVELS[level];
	return setting.options.some((each) => each.value === effort)
		? effort
		: undefined;
}
