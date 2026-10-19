import { homedir } from "node:os";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { LEGACY_DIR, unmigrated } from "../config";
import type { Agent } from "../conversations";
import { fail } from "../exit";
import { type Document, FsStorage, type Storage } from "../storage";

/**
 * The agents splates can start, and the models each runs, kept in one file
 * under the user's home rather than per project: an orchestrator in any
 * project, of any model family, can read it to delegate to any other.
 */
export class Roster {
	constructor(
		/** `~/.splates/agents.json`, or a test's own. */
		private readonly doc: Document<unknown>,
		/** Where the file is, as a message names it. */
		readonly path: string = doc.key,
	) {}

	/** The roster kept in `agents.json` of `storage`, the machine's. */
	static in(storage: Storage): Roster {
		return new Roster(
			storage.document("agents.json"),
			storage instanceof FsStorage ? storage.path("agents.json") : undefined,
		);
	}

	/** The file's JSON, null when there is none; a file not JSON is refused. */
	private async load(): Promise<unknown> {
		try {
			return await this.doc.read();
		} catch {
			fail("usage", `${this.path} is not JSON: fix or delete it`, {
				path: this.path,
			});
		}
	}

	/**
	 * Writes the defaults when there is no roster yet, saying whether it did,
	 * so the user has a file to edit rather than a list they cannot see.
	 */
	async seed(): Promise<boolean> {
		if ((await this.doc.read().catch(() => ({}))) !== null) {
			return false;
		}
		await this.doc.write({ format: FORMAT, agents: DEFAULT_AGENTS });
		return true;
	}

	/**
	 * Puts `agent` on the roster running `models`, in the default roster's
	 * order, creating the file when there is none. Only that agent's entry
	 * changes: another agent, this one's launch arguments and any model of its
	 * own that the defaults do not list stay as they are.
	 */
	async choose(agent: string, models: readonly string[]): Promise<void> {
		const base = DEFAULT_AGENTS.find((each) => each.id === agent);
		if (base === undefined) {
			fail("usage", `no default agent '${agent}' to choose models for`, {
				agent,
			});
		}
		// Read first, so a roster that will not parse is reported, not overwritten.
		await this.agents();
		const file = ((await this.doc.read().catch(() => null)) ?? {
			agents: [],
		}) as { format?: number; agents: RosterEntry[] };
		const entry = file.agents.find((each) => each.id === agent);
		const own = entry?.models ?? [];
		const listed = base.models.map((each) => each.id);
		const chosen = base.models
			.filter((each) => models.includes(each.id))
			.map((each) => own.find((kept) => kept.id === each.id) ?? each);
		const custom = own.filter((kept) => !listed.includes(kept.id));
		const written = { ...(entry ?? base), models: [...chosen, ...custom] };
		file.agents = entry
			? file.agents.map((each) => (each === entry ? written : each))
			: [...file.agents, written];
		await this.write(file);
	}

	/**
	 * Takes `agent` off the roster, leaving every other entry as it is. A
	 * roster that does not list it, or no roster at all, is left alone; one
	 * left with no agents stays, empty, rather than going back to the defaults.
	 */
	async remove(agent: string): Promise<void> {
		// Read first, so a roster that will not parse is reported, not overwritten.
		await this.agents();
		const file = (await this.doc.read().catch(() => null)) as {
			format?: number;
			agents: RosterEntry[];
		} | null;
		if (file === null) {
			return;
		}
		if (!file.agents.some((each) => each.id === agent)) {
			return;
		}
		file.agents = file.agents.filter((each) => each.id !== agent);
		await this.write(file);
	}

	/** Every agent on the roster, in its order; the defaults when there is none. */
	async agents(): Promise<RosterAgent[]> {
		const json = await this.load();
		if (json === null) {
			return DEFAULT_AGENTS;
		}
		const format = (json as { format?: unknown } | null)?.format;
		if (typeof format === "number" && format > FORMAT) {
			fail(
				"outdated",
				[
					`${this.path} is in format ${format}, written by a newer splates; this one understands up to ${FORMAT}, so it leaves it alone.`,
					"Run `bunx @stringsync/splates@latest` instead.",
				].join("\n"),
				{ path: this.path, format, understood: FORMAT },
			);
		}
		const parsed = schema.safeParse(json);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			fail(
				"usage",
				`${this.path} is not a roster: ${issue?.path.join(".") || "the file"}: ${issue?.message}. Fix it, or delete it for the defaults`,
				{ path: this.path },
			);
		}
		const agents = parsed.data.agents;
		const twice = agents.find(
			(agent, i) => agents.findIndex((each) => each.id === agent.id) !== i,
		);
		if (twice !== undefined) {
			fail(
				"usage",
				`${this.path} lists agent '${twice.id}' twice: give each its own id`,
				{ path: this.path, agent: twice.id },
			);
		}
		return agents;
	}

	private async write(file: {
		format?: number;
		agents: RosterEntry[];
	}): Promise<void> {
		await this.doc.write({ format: FORMAT, ...file });
	}
}

/** An agent as the file holds it, with whatever else a user kept on it. */
interface RosterEntry {
	id: string;
	models: RosterModel[];
	[key: string]: unknown;
}

/** The roster's own format. */
const FORMAT = 1;

/** A model an agent can run, and what picking it buys. */
export interface RosterModel {
	/** What the agent's Model setting takes: `opus`, `gpt-6-luna`. */
	id: string;
	name: string;
	/** What it is good at, so an orchestrator can choose it for a job. */
	strengths: string;
	/** What it costs, relative to the others or as a price. */
	cost: string;
	/** How capable it is, 1 (weakest) to 4 (strongest). */
	tier?: number;
	/** How quickly it answers. */
	speed?: Speed;
	/** What it costs against the others, 1 (cheapest) to 4 (dearest). */
	costRank?: number;
}

/** How quickly a model answers. */
export type Speed = "fast" | "medium" | "slow";

/** An agent on the roster: how to start it, and the models it runs. */
export interface RosterAgent extends Agent {
	models: RosterModel[];
}

const schema = z.object({
	format: z.number().int().positive().optional(),
	agents: z.array(
		z.object({
			id: z.string().min(1),
			name: z.string().min(1),
			argv: z.array(z.string()).min(1),
			models: z.array(
				z.object({
					id: z.string().min(1),
					name: z.string().min(1),
					strengths: z.string(),
					cost: z.string(),
					tier: z.number().int().min(1).max(4).optional(),
					speed: z.enum(["fast", "medium", "slow"]).optional(),
					costRank: z.number().int().min(1).max(4).optional(),
				}),
			),
		}),
	),
});

/**
 * The roster a machine starts with: each agent is the ACP adapter its maker
 * publishes, fetched by `bunx` on first use, and its models are those the
 * adapter offers, by the ids its Model setting takes.
 */
export const DEFAULT_AGENTS: RosterAgent[] = [
	{
		id: "claude",
		name: "Claude",
		argv: ["bunx", "@agentclientprotocol/claude-agent-acp"],
		models: [
			{
				id: "fable",
				name: "Fable 5.1",
				strengths: "the toughest and longest-running work",
				cost: "highest",
				tier: 4,
				speed: "slow",
				costRank: 4,
			},
			{
				id: "opus",
				name: "Opus 5.5",
				strengths: "complex work and everyday tasks; Claude's default",
				cost: "high",
				tier: 3,
				speed: "medium",
				costRank: 3,
			},
			{
				id: "sonnet",
				name: "Sonnet 5.5",
				strengths: "simpler, well-specified tasks",
				cost: "medium",
				tier: 2,
				speed: "medium",
				costRank: 2,
			},
			{
				id: "haiku",
				name: "Haiku 5.5",
				strengths: "quick answers and mechanical edits",
				cost: "low",
				tier: 1,
				speed: "fast",
				costRank: 1,
			},
		],
	},
	{
		id: "codex",
		name: "Codex",
		argv: ["bunx", "@agentclientprotocol/codex-acp"],
		models: [
			{
				id: "gpt-6-astra",
				name: "6 Astra",
				strengths: "Codex's default, for complex work",
				cost: "high",
				tier: 3,
				speed: "medium",
				costRank: 3,
			},
			{
				id: "gpt-6.1-sol",
				name: "6.1 Sol",
				strengths: "everyday coding work, the latest workhorse",
				cost: "medium",
				tier: 2,
				speed: "medium",
				costRank: 2,
			},
			{
				id: "gpt-6-luna",
				name: "6 Luna",
				strengths: "easier tasks, fast",
				cost: "low",
				tier: 1,
				speed: "fast",
				costRank: 1,
			},
		],
	},
];

/** An agent off the roster, on one of its models, or on its own without one. */
export interface AgentPick {
	agent: string;
	/** The roster's id for the model, which the agent's Model setting takes. */
	model?: string;
	/** The thinking level, by the value the agent's thought_level setting takes; absent, the agent's own. */
	effort?: string;
}

/** The models `agent` runs, as the roster lists them; none for an agent off it. */
export function modelsOf(agent: Agent): RosterModel[] {
	return "models" in agent ? (agent as RosterAgent).models : [];
}

/** What the router compares models by; every field is always known. */
export interface ModelTraits {
	tier: number;
	speed: Speed;
	costRank: number;
}

/**
 * Speed, tier and cost rank of `pick`'s model: the roster's own, else the
 * default roster's for that agent and model, so an `agents.json` written before
 * these fields still ranks. Undefined for a pick on no model, or one neither
 * knows or whose fields are still missing.
 */
export function traitsOf(
	agents: RosterAgent[],
	pick: AgentPick,
): ModelTraits | undefined {
	const find = (list: RosterAgent[]) =>
		list
			.find((each) => each.id === pick.agent)
			?.models.find((each) => each.id === pick.model);
	const own = find(agents);
	const base = find(DEFAULT_AGENTS);
	const tier = own?.tier ?? base?.tier;
	const speed = own?.speed ?? base?.speed;
	const costRank = own?.costRank ?? base?.costRank;
	return tier === undefined || speed === undefined || costRank === undefined
		? undefined
		: { tier, speed, costRank };
}

/** `pick` in a word: `claude`, or `claude (opus)` on a model. */
export function pickLabel(pick: AgentPick): string {
	const on = [pick.model, pick.effort].filter((each) => each !== undefined);
	return on.length === 0 ? pick.agent : `${pick.agent} (${on.join(", ")})`;
}

/**
 * `agent` on `model`, named by its id or name in any case, as the roster's
 * ids; OpenCode and provider-qualified models require an exact ID. Refuses an agent or a model the roster does not list, saying so with
 * `data`. An agent whose models the roster leaves out takes the model as
 * given.
 */
export function pickAgent(
	agents: RosterAgent[],
	agent: string,
	model: string | undefined,
	data: Record<string, unknown> = {},
): AgentPick {
	const found = agents.find((each) => each.id === agent);
	if (found === undefined) {
		fail(
			"usage",
			`no agent '${agent}' on the roster: use one of ${agents.map((each) => each.id).join(", ")} (\`splates agents\` lists them; ~/.splates/agents.json keeps them)`,
			{ ...data, agent },
		);
	}
	if (model === undefined || found.models.length === 0) {
		return model === undefined ? { agent } : { agent, model };
	}
	const wanted = model.toLowerCase();
	const picked = found.models.find(
		(each) =>
			each.id === model ||
			(agent !== "opencode" &&
				!model.includes("/") &&
				!each.id.includes("/") &&
				(each.id.toLowerCase() === wanted ||
					each.name.toLowerCase() === wanted)),
	);
	if (picked === undefined) {
		fail(
			"usage",
			`${found.name} has no model '${model}' on the roster: use one of ${found.models.map((each) => each.id).join(", ")}`,
			{ ...data, agent, model },
		);
	}
	return { agent, model: picked.id };
}

/** Where the user's splates files live: `~/.splates`, or `SPLATES_HOME`, as the tests set. */
export function splatesHome(ps: Ps): string {
	const home = ps.env("HOME") ?? homedir();
	return (
		ps.env("SPLATES_HOME") ??
		unmigrated(`${home}/.splates`, `${home}/.${LEGACY_DIR}`)
	);
}
