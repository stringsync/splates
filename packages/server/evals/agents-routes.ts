import type { Fs } from "webappwiz/system";
import { type AutoPickAgent, pickableAgents } from "../auto-pick";
import type { AgentPick } from "../models";
import { body, type Handler } from "../server/shared";
import { EvalAgentsStore, NATIVE_AGENTS } from "./agents";

/** The agents the Evals page edits, with what each pick can name. */
export interface EvalAgentsView {
	/** The agents saved; none when the file is missing or broken. */
	agents: AgentPick[];
	/** Why the file could not be read, so saving would replace it; null when it read. */
	problem: string | null;
	/** The roster's agents the runner can start natively, for a pick to name. */
	roster: AutoPickAgent[];
}

/** How the Evals page reads and writes this machine's eval agents. */
export class EvalAgentsRoutes {
	private readonly store: EvalAgentsStore;

	constructor(private readonly opts: { fs: Fs; home: string }) {
		this.store = new EvalAgentsStore(`${opts.home}/eval-agents.json`, opts.fs);
	}

	/** The agents and what a pick can name. */
	readonly read: Handler = async () => Response.json(await this.view());

	/** Saves the body's `agents`, answering the view of them, or a 400 saying what does not check out. */
	readonly save: Handler = async (request) => {
		const { agents } = await body(request);
		await this.store.save(agents);
		return Response.json(await this.view());
	};

	private async view(): Promise<EvalAgentsView> {
		let agents: AgentPick[] = [];
		let problem: string | null = null;
		try {
			agents = await this.store.agents();
		} catch (error) {
			if (!(error instanceof Error)) {
				throw error;
			}
			problem = error.message;
		}
		const roster = await pickableAgents(this.opts.fs, this.opts.home);
		return {
			agents,
			problem,
			roster: roster.filter((each) => NATIVE_AGENTS.includes(each.id)),
		};
	}
}
