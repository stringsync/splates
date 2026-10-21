import type { Fs } from "webappwiz/system";
import { Exit } from "../exit";
import { effortsOf, Offered, Roster } from "../models";
import { body } from "../server/shared";
import { FsStorage } from "../storage";
import { DEFAULT_RULES } from "./defaults";
import type { AutoPickRules } from "./rules";
import { AutoPickStore } from "./store";

/** The rules as Setup's editor reads them, with what each pick can name. */
export interface AutoPickRulesView {
	/** The rules saved, or the defaults when the file is missing or broken. */
	rules: AutoPickRules;
	/** Why the file could not be read, so saving would replace it; null when it read. */
	problem: string | null;
	/** The roster's agents, in its order, for a pick to name. */
	agents: AutoPickAgent[];
}

/** An agent a pick can name, and what it can name with it. */
export interface AutoPickAgent {
	id: string;
	name: string;
	/** The roster's models for it; none when the roster leaves them to the agent. */
	models: { id: string; name: string }[];
	/**
	 * The thinking levels it offered when it last ran here, by value; null
	 * when it never ran here, so what it takes is not known yet.
	 */
	efforts: string[] | null;
}

/**
 * How Setup reads and writes this machine's Auto pick rules, the one
 * mapping every project shares. Each handler is a property, so `dev` hands
 * them straight to its routes, as it does `SetupRoutes`'.
 */
export class AutoPickRulesRoutes {
	readonly #fs: Fs;
	readonly #home: string;

	constructor({ fs, home }: { fs: Fs; home: string }) {
		this.#fs = fs;
		this.#home = home;
	}

	/** The rules and the agents a pick can name. */
	readonly read = async (): Promise<Response> =>
		Response.json(await this.#view());

	/**
	 * Saves the rules the body's `rules` holds, answering the view of them,
	 * or a 400 whose message says what does not check out, the file untouched.
	 */
	readonly save = async (request: Request): Promise<Response> => {
		const { rules } = await body(request);
		await this.#store.save(rules as AutoPickRules);
		return Response.json(await this.#view());
	};

	/** Writes the defaults over the rules, answering the view of them. */
	readonly reset = async (): Promise<Response> => {
		await this.#store.reset();
		return Response.json(await this.#view());
	};

	get #store(): AutoPickStore {
		return new AutoPickStore(`${this.#home}/auto-pick.json`, { fs: this.#fs });
	}

	async #view(): Promise<AutoPickRulesView> {
		let rules = DEFAULT_RULES;
		let problem: string | null = null;
		try {
			rules = await this.#store.rules();
		} catch (error) {
			if (!(error instanceof Exit)) {
				throw error;
			}
			problem = error.message;
		}
		return {
			rules,
			problem,
			agents: await pickableAgents(this.#fs, this.#home),
		};
	}
}

/** The roster's agents in its order, each with the models and thinking levels a pick can name. */
export async function pickableAgents(
	fs: Fs,
	home: string,
): Promise<AutoPickAgent[]> {
	const machine = new FsStorage(home, fs);
	const offered = await new Offered(machine.document("offered.json")).all();
	const roster = await Roster.in(machine).agents();
	return roster.map((agent) => ({
		id: agent.id,
		name: agent.name,
		models: agent.models.map(({ id, name }) => ({ id, name })),
		efforts:
			offered[agent.id] === undefined
				? null
				: effortsOf(offered[agent.id] ?? []),
	}));
}
