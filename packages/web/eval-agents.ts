import type { AutoPickAgent } from "@stringsync/splates-server/auto-pick";
import type { EvalAgentsView } from "@stringsync/splates-server/evals/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { evalAgents, saveEvalAgents } from "./api";
import type { PickList } from "./auto-pick-pick-chips";
import { EFFORTS } from "./auto-pick-rules";

/** Where the editor reads and writes the machine's eval agents. */
export interface EvalAgentsStore {
	read(): Promise<EvalAgentsView>;
	save(agents: AgentPick[]): Promise<EvalAgentsView>;
}

export type EvalAgentsEvents = { changed: undefined };

/**
 * The Evals page's list of agents an eval runs on, each a full pick: agent,
 * model and thinking level. An edit saves at once and shows once the
 * server has it, one at a time; `problem` says why when the server refuses
 * it. Starts no eval: it only keeps the list.
 */
export class EvalAgentsEditor implements Eventful<EvalAgentsEvents>, PickList {
	private readonly dispatcher = new Dispatcher<EvalAgentsEvents>();
	readonly events = this.dispatcher.events;

	readonly label = "evals";
	readonly note = null;
	readonly least = 0;

	/** The agents as the server has them. */
	picks: readonly AgentPick[] = [];
	/** The roster's agents the runner can start natively. */
	agents: readonly AutoPickAgent[] = [];
	/** Whether an edit awaits the server, which allows no other. */
	saving = false;
	/** Whether the list was read. */
	loaded = false;
	/** Why the list could not be read or saved; null when it could. */
	problem: string | null = null;

	constructor(private readonly store: EvalAgentsStore = HTTP_AGENTS) {}

	async load(): Promise<void> {
		if (this.loaded) {
			return;
		}
		try {
			this.take(await this.store.read());
			this.problem = null;
		} catch (error) {
			this.problem = error instanceof Error ? error.message : String(error);
		}
		this.changed();
	}

	efforts(agent: string): string[] {
		return this.agents.find((each) => each.id === agent)?.efforts ?? EFFORTS;
	}

	/** Whether the list names `agent` on `model` at the level of pick `except`, or at the default level. */
	has(agent: string, model: string | undefined, except?: number): boolean {
		const effort =
			except === undefined ? undefined : this.picks[except]?.effort;
		return this.picks.some(
			(each, at) =>
				at !== except &&
				each.agent === agent &&
				each.model === model &&
				each.effort === effort,
		);
	}

	add(agent: string, model: string | undefined): void {
		if (this.has(agent, model)) {
			return;
		}
		const pick: AgentPick = { agent };
		if (model !== undefined) {
			pick.model = model;
		}
		this.edit([...this.picks, pick]);
	}

	remove(pick: number): void {
		this.edit(this.picks.filter((_, at) => at !== pick));
	}

	move(from: number, to: number): void {
		const moved = this.picks[from];
		if (moved === undefined || from === to || to < 0) {
			return;
		}
		const picks = this.picks.filter((_, at) => at !== from);
		picks.splice(to, 0, moved);
		this.edit(picks);
	}

	setModel(pick: number, model: string | undefined): void {
		const current = this.picks[pick];
		if (current === undefined || this.has(current.agent, model, pick)) {
			return;
		}
		const { model: _, ...rest } = current;
		this.edit(
			this.picks.map((each, at) =>
				at === pick ? (model === undefined ? rest : { ...rest, model }) : each,
			),
		);
	}

	setEffort(pick: number, effort: string | undefined): void {
		const current = this.picks[pick];
		if (current === undefined) {
			return;
		}
		const { effort: _, ...rest } = current;
		const next: AgentPick = effort === undefined ? rest : { ...rest, effort };
		if (
			this.picks.some(
				(each, at) =>
					at !== pick &&
					each.agent === next.agent &&
					each.model === next.model &&
					each.effort === next.effort,
			)
		) {
			return;
		}
		this.edit(this.picks.map((each, at) => (at === pick ? next : each)));
	}

	/** Saves `picks`, held pending until the server shows them; a refusal is put in `problem`. */
	private edit(picks: AgentPick[]): void {
		if (this.saving) {
			return;
		}
		this.saving = true;
		this.problem = null;
		this.changed();
		this.store.save(picks).then(
			(view) => {
				this.saving = false;
				this.take(view);
				this.changed();
			},
			(error: unknown) => {
				this.saving = false;
				this.problem = error instanceof Error ? error.message : String(error);
				this.changed();
			},
		);
	}

	private take(view: EvalAgentsView): void {
		this.picks = view.agents;
		this.agents = view.roster;
		this.loaded = true;
		if (view.problem !== null) {
			this.problem = view.problem;
		}
	}

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}

/** The eval agents over `splates server`'s routes. */
const HTTP_AGENTS: EvalAgentsStore = {
	read: evalAgents,
	save: saveEvalAgents,
};
