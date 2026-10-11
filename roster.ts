import { homedir } from "node:os";
import type { Fs, Ps } from "webappwiz/system";
import { z } from "zod";
import type { Agent } from "./conversations";
import { fail } from "./exit";

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
}

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
			},
			{
				id: "opus",
				name: "Opus 5.5",
				strengths: "complex work and everyday tasks; Claude's default",
				cost: "high",
			},
			{
				id: "sonnet",
				name: "Sonnet 5.5",
				strengths: "simpler, well-specified tasks",
				cost: "medium",
			},
			{
				id: "haiku",
				name: "Haiku 5.5",
				strengths: "quick answers and mechanical edits",
				cost: "low",
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
			},
			{
				id: "gpt-6-luna",
				name: "6 Luna",
				strengths: "easier tasks, fast",
				cost: "low",
			},
		],
	},
];

/** Where the user's arbor files live: `~/.arbor`, or `ARBOR_HOME`, as the tests set. */
export function arborHome(ps: Ps): string {
	return ps.env("ARBOR_HOME") ?? `${ps.env("HOME") ?? homedir()}/.arbor`;
}

/**
 * The agents arbor can start, and the models each runs, kept in one file
 * under the user's home rather than per project: an orchestrator in any
 * project, of any model family, can read it to delegate to any other.
 */
export class Roster {
	constructor(
		/** `~/.arbor/agents.json`, or a test's own. */
		readonly path: string,
		private readonly deps: { fs: Fs },
	) {}

	/**
	 * Writes the defaults when there is no roster yet, saying whether it did,
	 * so the user has a file to edit rather than a list they cannot see.
	 */
	async seed(): Promise<boolean> {
		if (await this.deps.fs.exists(this.path)) {
			return false;
		}
		await this.deps.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")));
		// Through a temporary file, so a reader never sees half of it.
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.deps.fs.write(
			tmp,
			`${JSON.stringify({ format: FORMAT, agents: DEFAULT_AGENTS }, null, "\t")}\n`,
		);
		await this.deps.fs.rename(tmp, this.path);
		return true;
	}

	/** Every agent on the roster, in its order; the defaults when there is none. */
	async agents(): Promise<RosterAgent[]> {
		const raw = await this.deps.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return DEFAULT_AGENTS;
		}
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			fail("usage", `${this.path} is not JSON: fix or delete it`, {
				path: this.path,
			});
		}
		const format = (json as { format?: unknown } | null)?.format;
		if (typeof format === "number" && format > FORMAT) {
			fail(
				"outdated",
				[
					`${this.path} is in format ${format}, written by a newer arbor; this one understands up to ${FORMAT}, so it leaves it alone.`,
					"Run `bunx @webappwiz/arbor@latest` instead.",
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
}
