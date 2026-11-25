import {
	type EvalBudgetView,
	type EvalGrid,
	type EvalLaunch,
	type EvalPlan,
	type EvalScenario,
	evalCardKey,
	targetOf,
} from "@splates/server/evals/browser";
import type { AgentPick } from "@splates/server/models";
import type { EvalAsk, PermissionProposal } from "@splates/server/plans";
import type { Resource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";
import { Duration, SystemTimer, type Timer } from "core/time";
import {
	type EvalRunAsk,
	evalAgents,
	evalBatch,
	evalBudget,
	evalLaunch,
	evalPlan,
	evalScenarios,
	stopEvalRun,
} from "./api";
import { refusalOf } from "./refusal";

/** What a run card reads and writes on the server. */
export interface EvalRunServer {
	/** The saved eval agents, which a card's agents are picked from. */
	savedAgents(): Promise<{ agents: AgentPick[] }>;
	scenarios(conversation: string | null): Promise<EvalScenario[]>;
	plan(run: EvalRunAsk): Promise<EvalPlan>;
	launch(key: string): Promise<EvalLaunch | null>;
	stop(key: string): Promise<void>;
	batch(id: string): Promise<EvalGrid>;
	/** Conversation `id`'s approved eval budget and what its rounds have spent. */
	budget(conversation: string): Promise<EvalBudgetView>;
}

export const HTTP_EVAL_RUN: EvalRunServer = {
	savedAgents: evalAgents,
	scenarios: evalScenarios,
	plan: evalPlan,
	launch: evalLaunch,
	stop: stopEvalRun,
	batch: evalBatch,
	budget: evalBudget,
};

/** What a test swaps: the server, and the clock the run is followed by. */
export interface EvalRunOptions {
	server?: EvalRunServer;
	timer?: Timer;
	/** The conversation the card is in, told by the server once the run is done. */
	conversation?: string | null;
	/** The message the card is in, which sets its run apart from identical cards. */
	message?: string | null;
}

export type EvalRunEvents = { changed: undefined };

/** How often a run in flight is read again. */
const FOLLOW = Duration.secs(2);

/** How many times a card with no run is read again before it settles on waiting for a budget. */
const WAIT_READS = 15;

/**
 * The round an agent's `run evals` card asks for: the cases it picked
 * grouped as the project's `evals.list` heads them, the agents it runs on
 * (those the card names, else the first saved), and what it may cost. The
 * server starts it by itself when that fits the conversation's approved
 * eval budget; until then it waits for a budget. Once it runs the card
 * follows the batch the runner writes: cells landed of those planned, the
 * tally and the cost so far. Reads and writes nothing until `load`.
 */
export class EvalRun implements Eventful<EvalRunEvents>, Resource {
	private readonly dispatcher = new Dispatcher<EvalRunEvents>();
	readonly events = this.dispatcher.events;

	/** The agents the round runs on. */
	picks: AgentPick[] = [];
	scenarios: EvalScenario[] = [];
	/** Every scenario the project's `list` returned, so the request card can show how many were not targeted. */
	allScenarios: EvalScenario[] = [];
	groups: ScenarioGroup[] = [];
	/** The scenarios the card names that the harness does not know. */
	unknown: string[] = [];
	/** The agents the card names that are not saved, left out of the run. */
	unknownAgents: string[] = [];
	plan: EvalPlan | null = null;
	/** The conversation's approved eval budget and its spend; null outside a conversation or until read. */
	budget: EvalBudgetView | null = null;
	launch: EvalLaunch | null = null;
	grid: EvalGrid | null = null;
	/** Why the last read or write refused, in the server's words. */
	refusal: string | null = null;
	loaded = false;

	/** Repetitions of each scenario on each agent. */
	readonly reps: number;
	private following: Resource | null = null;
	/** Reads again while the card waits on the server to start it. */
	private waiting: Resource | null = null;
	private loading: Promise<void> | null = null;

	private readonly server: EvalRunServer;
	private readonly timer: Timer;
	private readonly conversation: string | null;

	constructor(
		readonly ask: EvalAsk,
		readonly key: string,
		opts: EvalRunOptions = {},
	) {
		this.reps = ask.reps ?? 1;
		this.server = opts.server ?? HTTP_EVAL_RUN;
		this.timer = opts.timer ?? new SystemTimer();
		this.conversation = opts.conversation ?? null;
		const shown = SHOWN.get(key);
		if (shown !== undefined) {
			// Reopening a conversation: show the card as it was, and read it
			// again behind it, rather than hold a placeholder of another height.
			this.picks = shown.agents;
			this.scenarios = shown.scenarios;
			this.allScenarios = shown.allScenarios;
			this.groups = shown.groups;
			this.unknown = shown.unknown;
			this.plan = shown.plan;
			this.launch = shown.launch;
			this.grid = shown.grid;
			this.loaded = true;
		}
	}

	static of(proposal: PermissionProposal, opts?: EvalRunOptions): EvalRun {
		const ask = proposal.evals as EvalAsk;
		return new EvalRun(
			ask,
			evalCardKey(
				ask,
				proposal.title,
				opts?.conversation ?? null,
				opts?.message ?? null,
			),
			opts,
		);
	}

	get running(): boolean {
		return this.launch?.status === "running";
	}

	/** Reads the card's server state; a call while one is going shares it. */
	load(): Promise<void> {
		this.loading ??= this.fetch().finally(() => {
			this.loading = null;
		});
		return this.loading;
	}

	private async fetch(): Promise<void> {
		let launch: EvalLaunch | null = null;
		try {
			const [saved, scenarios, found] = await Promise.all([
				this.server.savedAgents(),
				this.server.scenarios(this.conversation),
				this.server.launch(this.key),
			]);
			launch = found;
			const named = this.ask.agents;
			this.picks =
				named === undefined
					? saved.agents.slice(0, 1)
					: saved.agents.filter((pick) => named.includes(targetOf(pick)));
			const have = new Set(saved.agents.map(targetOf));
			this.unknownAgents = (named ?? []).filter((each) => !have.has(each));
			const listed = Array.isArray(scenarios) ? scenarios : [];
			this.allScenarios = listed;
			this.scenarios = listed.filter((each) =>
				this.ask.scenarios.includes(each.id),
			);
			this.groups = groupsOf(this.scenarios);
			const known = new Set(listed.map((each) => each.id));
			this.unknown = this.ask.scenarios.filter((each) => !known.has(each));
			this.launch = launch;
			this.refusal = null;
		} catch (error) {
			this.refusal = refusalOf("Could not read the evals", error);
		}
		await this.readBudget();
		if (this.refusal === null && launch !== null) {
			// A running card shows its progress with its first paint.
			await this.follow();
		} else if (this.refusal === null) {
			await this.replan();
		}
		this.loaded = true;
		this.changed();
		if (this.refusal === null && this.launch === null) {
			this.waitForStart();
		}
	}

	async stop(): Promise<void> {
		try {
			await this.server.stop(this.key);
			await this.read();
		} catch (error) {
			this.refusal = refusalOf("Not stopped", error);
			this.changed();
		}
	}

	dispose(): void {
		this.following?.dispose();
		this.following = null;
		this.waiting?.dispose();
		this.waiting = null;
	}

	private request(): EvalRunAsk {
		return {
			skill: this.ask.skill,
			scenarios: this.ask.scenarios,
			agents: [...this.picks],
			baseline: this.ask.baseline,
			reps: this.reps,
			conversation: this.conversation,
		};
	}

	private async replan(): Promise<void> {
		if (this.picks.length === 0) {
			this.plan = null;
			return;
		}
		try {
			this.plan = await this.server.plan(this.request());
		} catch (error) {
			this.plan = null;
			this.refusal = refusalOf("No plan", error);
		}
	}

	/**
	 * Reads the run once, and again every `FOLLOW` while it is going. A card
	 * with no run yet is read again while the server may still start it.
	 */
	private async follow(): Promise<void> {
		await this.read();
		if (this.launch === null) {
			this.waitForStart();
			return;
		}
		if (this.running && this.following === null) {
			this.following = this.timer.setInterval(() => {
				void this.read().then(() => {
					if (!this.running) {
						this.following?.dispose();
						this.following = null;
					}
				});
			}, FOLLOW);
		}
	}

	private async read(): Promise<void> {
		try {
			this.launch = (await this.server.launch(this.key)) ?? this.launch;
			const batch = this.launch?.batch ?? null;
			if (batch !== null) {
				this.grid = await this.server.batch(batch);
			}
			this.refusal = null;
			await this.readBudget();
		} catch (error) {
			this.refusal = refusalOf("Could not follow the run", error);
		}
		this.changed();
	}

	/**
	 * Reads the card's launch every `FOLLOW` for a short while, as the server
	 * starts a round that fits the budget a moment after the turn ends; then
	 * follows it.
	 */
	private waitForStart(): void {
		if (this.waiting !== null) {
			return;
		}
		let left = WAIT_READS;
		this.waiting = this.timer.setInterval(() => {
			left -= 1;
			void this.read().then(() => {
				if (this.launch !== null || left <= 0) {
					this.waiting?.dispose();
					this.waiting = null;
					if (this.launch !== null) {
						void this.follow();
					}
				}
			});
		}, FOLLOW);
	}

	/** Reads the budget and the conversation's spend, which a missing budget never holds the card up for. */
	private async readBudget(): Promise<void> {
		if (this.conversation === null) {
			return;
		}
		this.budget = await this.server
			.budget(this.conversation)
			.catch(() => this.budget);
	}

	private changed(): void {
		if (this.loaded && this.refusal === null) {
			SHOWN.set(this.key, {
				agents: [...this.picks],
				scenarios: this.scenarios,
				allScenarios: this.allScenarios,
				groups: this.groups,
				unknown: this.unknown,
				plan: this.plan,
				launch: this.launch,
				grid: this.grid,
			});
		}
		this.dispatcher.dispatch("changed");
	}
}

/** What a card last showed, kept so reopening its conversation paints it at once. */
interface Shown {
	scenarios: EvalScenario[];
	allScenarios: EvalScenario[];
	agents: AgentPick[];
	groups: ScenarioGroup[];
	unknown: string[];
	plan: EvalPlan | null;
	launch: EvalLaunch | null;
	grid: EvalGrid | null;
}

const SHOWN = new Map<string, Shown>();

/** Forgets what cards showed, for a test that starts clean. */
export function forgetShownEvals(): void {
	SHOWN.clear();
}

function groupsOf(scenarios: EvalScenario[]): ScenarioGroup[] {
	const groups: ScenarioGroup[] = [];
	for (const scenario of scenarios) {
		const name = scenario.group ?? "";
		let group = groups.find((each) => each.group === name);
		if (group === undefined) {
			group = { group: name, abouts: [] };
			groups.push(group);
		}
		const about = scenario.about ?? "";
		let each = group.abouts.find((one) => one.about === about);
		if (each === undefined) {
			each = { about, scenarios: [] };
			group.abouts.push(each);
		}
		each.scenarios.push(scenario.id);
	}
	return groups;
}

/** The card's cases under a heading, by what each checks; either may be empty. */
export interface ScenarioGroup {
	group: string;
	abouts: { about: string; scenarios: string[] }[];
}
