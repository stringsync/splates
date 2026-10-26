import type {
	EvalGrid,
	EvalLaunch,
	EvalPlan,
	EvalScenario,
} from "@stringsync/splates-server/evals/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import type {
	EvalAsk,
	PermissionProposal,
} from "@stringsync/splates-server/plans";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import {
	type EvalRunAsk,
	evalAgents,
	evalBatch,
	evalLaunch,
	evalPlan,
	evalScenarios,
	startEvalRun,
	stopEvalRun,
} from "./api";
import { refusalOf } from "./refusal";

/** What a run card reads and writes on the server. */
export interface EvalRunServer {
	savedAgents(): Promise<AgentPick[]>;
	scenarios(): Promise<EvalScenario[]>;
	plan(run: EvalRunAsk): Promise<EvalPlan>;
	start(key: string, run: EvalRunAsk): Promise<EvalLaunch>;
	launch(key: string): Promise<EvalLaunch | null>;
	stop(key: string): Promise<void>;
	batch(id: string): Promise<EvalGrid>;
}

export const HTTP_EVAL_RUN: EvalRunServer = {
	savedAgents: async () => (await evalAgents()).agents,
	scenarios: evalScenarios,
	plan: evalPlan,
	start: startEvalRun,
	launch: evalLaunch,
	stop: stopEvalRun,
	batch: evalBatch,
};

/** What a test swaps: the server, and the clock the run is followed by. */
export interface EvalRunOptions {
	server?: EvalRunServer;
	timer?: Timer;
	/** The conversation the card is in, told by the server once the run is done. */
	conversation?: string | null;
}

export type EvalRunEvents = { changed: undefined };

/** How often a run in flight is read again. */
const FOLLOW = Duration.secs(2);

/** One scenario's place on the card: its aspect, requirement and id. */
export interface ScenarioGroup {
	aspect: string;
	requirements: { requirement: string; scenarios: string[] }[];
}

/**
 * The run an agent's `run evals` card asks for, for the person to start: the
 * scenarios it picked grouped by aspect and requirement, the saved agents
 * (each of which can be left out for this run), and the free plan's
 * reservation. Starting is the person's, through `run`; once it runs the
 * card follows the batch the runner writes: cells landed of those planned,
 * the tally and the cost so far. Reads and writes nothing until `load`.
 */
export class EvalRun implements Eventful<EvalRunEvents>, Resource {
	private readonly dispatcher = new Dispatcher<EvalRunEvents>();
	readonly events = this.dispatcher.events;

	/** The agents saved, each with whether this run uses it. */
	agents: { pick: AgentPick; on: boolean }[] = [];
	groups: ScenarioGroup[] = [];
	/** The scenarios the card names that the harness does not know. */
	unknown: string[] = [];
	plan: EvalPlan | null = null;
	launch: EvalLaunch | null = null;
	grid: EvalGrid | null = null;
	/** Why the last read or write refused, in the server's words. */
	refusal: string | null = null;
	loaded = false;

	private following: Resource | null = null;
	private planning = 0;

	private readonly server: EvalRunServer;
	private readonly timer: Timer;
	private readonly conversation: string | null;

	constructor(
		readonly ask: EvalAsk,
		readonly key: string,
		opts: EvalRunOptions = {},
	) {
		this.server = opts.server ?? HTTP_EVAL_RUN;
		this.timer = opts.timer ?? new SystemTimer();
		this.conversation = opts.conversation ?? null;
	}

	static of(proposal: PermissionProposal, opts?: EvalRunOptions): EvalRun {
		const ask = proposal.evals as EvalAsk;
		return new EvalRun(
			ask,
			`${ask.skill}:${ask.scenarios.join(",")}:${proposal.title ?? ""}`,
			opts,
		);
	}

	/** The agents picked for this run. */
	get picked(): AgentPick[] {
		return this.agents.filter((each) => each.on).map((each) => each.pick);
	}

	/** Whether a run is going, or has gone, from this card. */
	get started(): boolean {
		return this.launch !== null;
	}

	get running(): boolean {
		return this.launch?.status === "running";
	}

	async load(): Promise<void> {
		try {
			const [saved, scenarios, launch] = await Promise.all([
				this.server.savedAgents(),
				this.server.scenarios(),
				this.server.launch(this.key),
			]);
			this.agents = saved.map((pick) => ({ pick, on: true }));
			this.groups = groupsOf(
				scenarios.filter((each) => this.ask.scenarios.includes(each.id)),
			);
			const known = new Set(scenarios.map((each) => each.id));
			this.unknown = this.ask.scenarios.filter((each) => !known.has(each));
			this.launch = launch;
			this.loaded = true;
			this.refusal = null;
		} catch (error) {
			this.refusal = refusalOf("Could not read the evals", error);
		}
		this.changed();
		if (this.launch !== null) {
			await this.follow();
		} else {
			await this.replan();
		}
	}

	/** Leaves a saved agent in or out of this run, and asks the plan again. */
	async toggle(index: number): Promise<void> {
		const each = this.agents[index];
		if (each === undefined || this.started) {
			return;
		}
		each.on = !each.on;
		this.changed();
		await this.replan();
	}

	/** The person's Run: starts the paid run, then follows it. */
	async run(): Promise<void> {
		try {
			const saved = await this.server.savedAgents();
			if (
				saved.length !== this.agents.length ||
				saved.some((pick, at) => {
					const shown = this.agents[at]?.pick;
					return (
						pick.agent !== shown?.agent ||
						pick.model !== shown?.model ||
						pick.effort !== shown?.effort
					);
				})
			) {
				// A card can outlive a correction to a rejected model. Show the
				// new picks and cost before the person authorizes that run.
				this.agents = saved.map((pick) => ({ pick, on: true }));
				this.plan = null;
				this.refusal =
					"Saved eval agents changed. Review the updated agents and press Run again.";
				this.changed();
				await this.replan();
				return;
			}
			this.launch = await this.server.start(this.key, {
				...this.request(),
				conversation: this.conversation,
			});
			this.refusal = null;
		} catch (error) {
			this.refusal = refusalOf("Not started", error);
			this.changed();
			return;
		}
		this.changed();
		await this.follow();
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
	}

	private request(): EvalRunAsk {
		return {
			skill: this.ask.skill,
			scenarios: this.ask.scenarios,
			agents: this.picked,
			baseline: this.ask.baseline,
		};
	}

	private async replan(): Promise<void> {
		const mine = ++this.planning;
		if (this.picked.length === 0) {
			this.plan = null;
			this.changed();
			return;
		}
		try {
			const plan = await this.server.plan(this.request());
			if (mine === this.planning) {
				this.plan = plan;
			}
		} catch (error) {
			this.plan = null;
			this.refusal = refusalOf("No plan", error);
		}
		this.changed();
	}

	/** Reads the run once, and again every `FOLLOW` while it is going. */
	private async follow(): Promise<void> {
		await this.read();
		if (this.running && this.following === null) {
			this.following = this.timer.setInterval(() => {
				void this.read().then(() => {
					if (!this.running) {
						this.dispose();
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
		} catch (error) {
			this.refusal = refusalOf("Could not follow the run", error);
		}
		this.changed();
	}

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}

function groupsOf(scenarios: EvalScenario[]): ScenarioGroup[] {
	const groups: ScenarioGroup[] = [];
	for (const scenario of scenarios) {
		let group = groups.find((each) => each.aspect === scenario.aspect);
		if (group === undefined) {
			group = { aspect: scenario.aspect, requirements: [] };
			groups.push(group);
		}
		let requirement = group.requirements.find(
			(each) => each.requirement === scenario.requirement,
		);
		if (requirement === undefined) {
			requirement = { requirement: scenario.requirement, scenarios: [] };
			group.requirements.push(requirement);
		}
		requirement.scenarios.push(scenario.id);
	}
	return groups;
}
