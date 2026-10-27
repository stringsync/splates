import { existsSync } from "node:fs";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import { body, type Handler } from "../server/shared";
import { NATIVE_AGENTS } from "./agents";
import type { EvalCommands, EvalLaunches, EvalLaunchSpec } from "./launch";

/** Where a conversation works, for a run its card starts to use the code there. */
export interface ConversationDirs {
	/** The directory conversation `id` works in; null when it is not known. */
	cwdOf(id: string): Promise<string | null>;
}

/** Which eval commands a request's project names. */
export interface EvalProjects {
	/** The eval commands of the project `request` names; null when it names no `evals`. */
	commandsOf(request: Request): Promise<EvalCommands | null>;
}

/**
 * How the Evals card lists, plans, starts, follows and stops a paid run,
 * through the commands the project of the request names.
 */
export class EvalLaunchRoutes {
	constructor(
		private readonly launches: EvalLaunches,
		private readonly projects: EvalProjects,
		private readonly dirs: ConversationDirs = { cwdOf: async () => null },
	) {}

	/** Every case the project lists, for the card to group; `?conversation=` lists its worktree's. */
	readonly scenarios: Handler = async (request) => {
		const commands = await this.commands(request);
		if (commands.list === null) {
			fail(
				"not_found",
				"this project names no evals.list in splates.config.ts",
				{},
			);
		}
		const conversation = new URL(request.url).searchParams.get("conversation");
		return Response.json(
			await this.launches.scenarios(commands, await this.cwdOf(conversation)),
		);
	};

	/** The free plan for the body's cases and agents: what the run would reserve. */
	readonly plan: Handler = async (request) => {
		const commands = await this.runnable(request);
		const sent = await body(request);
		return Response.json(
			await this.launches.plan(commands, {
				...this.spec(sent),
				cwd: await this.cwdOf(this.conversation(sent)),
			}),
		);
	};

	/** Starts the run; only the person's Run button sends this. */
	readonly start: Handler = async (request) => {
		const commands = await this.runnable(request);
		// A request's body reads once, so the spec and its key share one read.
		const sent = await body(request);
		const spec = this.spec(sent);
		const { key } = sent;
		if (typeof key !== "string" || key === "") {
			fail("usage", "a run names its card by `key`", {});
		}
		const conversation = this.conversation(sent);
		return Response.json(
			await this.launches.start(commands, {
				...spec,
				key,
				conversation,
				// The conversation's task worktree, so a run checks the change it makes.
				cwd: await this.cwdOf(conversation),
			}),
		);
	};

	/** `?key=` names the card; null when it has no run here. */
	readonly read: Handler = async (request) =>
		Response.json(
			await this.launches.get(await this.commands(request), this.key(request)),
		);

	/** Stops the run `?key=` names. */
	readonly stop: Handler = async (request) =>
		Response.json(
			await this.launches.stop(await this.commands(request), this.key(request)),
		);

	private async commands(request: Request): Promise<EvalCommands> {
		const commands = await this.projects.commandsOf(request);
		if (commands === null) {
			fail("not_found", "this project names no evals in splates.config.ts", {});
		}
		return commands;
	}

	private async runnable(request: Request): Promise<EvalCommands> {
		const commands = await this.commands(request);
		if (commands.run === null) {
			fail(
				"not_found",
				"this project names no evals.run in splates.config.ts",
				{},
			);
		}
		return commands;
	}

	/** Where conversation `id` works, when it still exists; null for none. */
	private async cwdOf(id: string | null): Promise<string | null> {
		const cwd = id === null || id === "" ? null : await this.dirs.cwdOf(id);
		return cwd !== null && existsSync(cwd) ? cwd : null;
	}

	private conversation(sent: Record<string, unknown>): string | null {
		const { conversation } = sent;
		if (conversation != null && typeof conversation !== "string") {
			fail("usage", "a run's conversation is its id", {});
		}
		return conversation ?? null;
	}

	private key(request: Request): string {
		return new URL(request.url).searchParams.get("key") ?? "";
	}

	private spec(
		sent: Record<string, unknown>,
	): Omit<EvalLaunchSpec, "key" | "conversation" | "cwd"> {
		const { skill, scenarios, agents, baseline, reps } = sent;
		if (typeof skill !== "string" || skill === "") {
			fail("usage", "a run names the skill or suite of its card", {});
		}
		if (
			!Array.isArray(scenarios) ||
			scenarios.length === 0 ||
			!scenarios.every((each) => typeof each === "string" && each !== "")
		) {
			fail("usage", "pick at least one scenario", {});
		}
		if (!Array.isArray(agents) || agents.length === 0) {
			fail("usage", "pick at least one agent to run on", {});
		}
		for (const pick of agents as AgentPick[]) {
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
		if (
			reps != null &&
			(typeof reps !== "number" || !Number.isInteger(reps) || reps < 1)
		) {
			fail("usage", "repetitions are a whole number of at least 1", {});
		}
		return {
			skill,
			scenarios,
			agents,
			baseline: baseline ?? null,
			...(reps == null ? {} : { reps }),
		};
	}
}
