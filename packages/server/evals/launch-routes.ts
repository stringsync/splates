import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import { body, type Handler } from "../server/shared";
import { NATIVE_AGENTS } from "./agents";
import type { EvalLaunches } from "./launch";

/** The skill whose probes exist today; another's slot in beside it. */
const SKILLS = ["splates"];

/** Where a conversation works, for a run its card starts to use the skill there. */
export interface ConversationDirs {
	/** The directory conversation `id` works in; null when it is not known. */
	cwdOf(id: string): Promise<string | null>;
}

/** How the Evals card plans, starts, follows and stops a paid run. */
export class EvalLaunchRoutes {
	constructor(
		private readonly launches: EvalLaunches | null,
		private readonly dirs: ConversationDirs = { cwdOf: async () => null },
	) {}

	/** Every registered probe, for the card to group by aspect and requirement. */
	readonly probes: Handler = async () =>
		Response.json(await this.ready().probes());

	/** The free plan for the body's probes and agents: what the run would reserve. */
	readonly plan: Handler = async (request) =>
		Response.json(await this.ready().plan(this.spec(await body(request))));

	/** Starts the run; only the person's Run button sends this. */
	readonly start: Handler = async (request) => {
		// A request's body reads once, so the spec and its key share one read.
		const sent = await body(request);
		const spec = this.spec(sent);
		const { key, conversation } = sent;
		if (typeof key !== "string" || key === "") {
			fail("usage", "a run names its card by `key`", {});
		}
		if (conversation != null && typeof conversation !== "string") {
			fail("usage", "a run's conversation is its id", {});
		}
		const cwd =
			typeof conversation === "string"
				? await this.dirs.cwdOf(conversation)
				: null;
		const skillDir = cwd === null ? null : join(cwd, "skills", "splates");
		return Response.json(
			await this.ready().start({
				...spec,
				key,
				conversation: conversation ?? null,
				// The conversation's skill, as its task edits it, when it has one.
				skillDir:
					skillDir !== null && existsSync(join(skillDir, "SKILL.md"))
						? skillDir
						: null,
			}),
		);
	};

	/** `?key=` names the card; null when it has no run here. */
	readonly read: Handler = async (request) =>
		Response.json(await this.ready().get(this.key(request)));

	/** Stops the run `?key=` names. */
	readonly stop: Handler = async (request) =>
		Response.json(await this.ready().stop(this.key(request)));

	private ready(): EvalLaunches {
		if (this.launches === null) {
			fail("not_found", "evals run from a splates checkout", {});
		}
		return this.launches;
	}

	private key(request: Request): string {
		return new URL(request.url).searchParams.get("key") ?? "";
	}

	private spec(sent: Record<string, unknown>): {
		skill: string;
		probes: string[];
		agents: AgentPick[];
		baseline: string | null;
	} {
		const { skill, probes, agents, baseline } = sent;
		if (typeof skill !== "string" || !SKILLS.includes(skill)) {
			fail("usage", `no probes for skill ${String(skill)}`, {});
		}
		if (
			!Array.isArray(probes) ||
			probes.length === 0 ||
			!probes.every((each) => typeof each === "string" && each !== "")
		) {
			fail("usage", "pick at least one probe", {});
		}
		if (!Array.isArray(agents) || agents.length === 0) {
			fail("usage", "pick at least one agent to run on", {});
		}
		for (const pick of agents) {
			if (
				typeof pick?.agent !== "string" ||
				!NATIVE_AGENTS.includes(pick.agent)
			) {
				fail("usage", "an agent is one of claude, codex and opencode", {});
			}
		}
		if (baseline != null && typeof baseline !== "string") {
			fail("usage", "the baseline is a revision", {});
		}
		return { skill, probes, agents, baseline: baseline ?? null };
	}
}
