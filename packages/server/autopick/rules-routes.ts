import type { Fs } from "core/system";
import { Exit } from "../exit";
import {
	effortsOf,
	Offered,
	RETIRED_AGENTS,
	Roster,
	type Speed,
} from "../models";
import { body } from "../server/shared";
import { type ModelProvider, modelProvider } from "../stats/model-provider";
import { FsStorage } from "../storage";
import { DEFAULT_RULES } from "./defaults";
import type { AutopickRules } from "./rules";
import { AutopickStore } from "./store";

/** The rules as Setup's editor reads them, with what each pick can name. */
export interface AutopickRulesView {
	/** The rules saved, or the defaults when the file is missing or broken. */
	rules: AutopickRules;
	/** Why the file could not be read, so saving would replace it; null when it read. */
	problem: string | null;
	/** The roster's agents, in its order, for a pick to name. */
	agents: AutopickAgent[];
}

/** A model a pick can name, with what a menu shows beside it. */
export interface PickableModel {
	id: string;
	name: string;
	/** Who made it, for its mark, even when another maker's agent runs it, when known. */
	provider?: ModelProvider;
	/** How quickly it answers, when the roster says. */
	speed?: Speed;
	/** What it costs against the others, 1 (cheapest) to 4 (dearest), when the roster says. */
	costRank?: number;
}

/** An agent a pick can name, and what it can name with it. */
export interface AutopickAgent {
	id: string;
	name: string;
	/** The roster's models for it; none when the roster leaves them to the agent. */
	models: PickableModel[];
	/**
	 * The thinking levels it offered when it last ran here, by value; null
	 * when it never ran here, so what it takes is not known yet.
	 */
	efforts: string[] | null;
}

/**
 * Lets Setup read and write this machine's Autopick rules, the one mapping
 * every project shares.
 */
export class AutopickRulesRoutes {
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
		await this.#store.save(rules as AutopickRules);
		return Response.json(await this.#view());
	};

	/** Writes the defaults over the rules, answering the view of them. */
	readonly reset = async (): Promise<Response> => {
		await this.#store.reset();
		return Response.json(await this.#view());
	};

	get #store(): AutopickStore {
		return new AutopickStore(`${this.#home}/auto-pick.json`, { fs: this.#fs });
	}

	async #view(): Promise<AutopickRulesView> {
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
): Promise<AutopickAgent[]> {
	const machine = new FsStorage(home, fs);
	const offered = await new Offered(machine.document("offered.json")).all();
	const roster = await Roster.in(machine).agents();
	return roster
		.filter((agent) => !RETIRED_AGENTS.includes(agent.id))
		.map((agent) => ({
			id: agent.id,
			name: agent.name,
			models: agent.models.map(({ id, name, speed, costRank }) => {
				const provider = modelProvider(id, roster);
				return {
					id,
					name,
					...(provider === null ? {} : { provider }),
					...(speed === undefined ? {} : { speed }),
					...(costRank === undefined ? {} : { costRank }),
				};
			}),
			efforts:
				offered[agent.id] === undefined
					? null
					: effortsOf(offered[agent.id] ?? []),
		}));
}
