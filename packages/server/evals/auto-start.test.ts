import { beforeEach, describe, expect, it } from "bun:test";
import type { AgentPick } from "../models";
import {
	autoStartEvalCard,
	type EvalAutoStartDeps,
	evalBudgetShortPrompt,
} from "./auto-start";
import type {
	EvalCommands,
	EvalLaunch,
	EvalLaunchSpec,
	EvalPlan,
} from "./launch";

describe("autoStartEvalCard", () => {
	let deps: FakeDeps;

	beforeEach(() => {
		deps = new FakeDeps();
	});

	it("starts the card's round on the first saved agent while it fits the approved budget", async () => {
		deps.spentSoFar = 8;
		deps.planned = { ...deps.planned, usd: 2 };

		const launch = await autoStartEvalCard(deps, COMMANDS, CARD);

		expect(launch !== null && "started" in launch && launch.started.auto).toBe(
			true,
		);
		expect(deps.started).toEqual([
			{
				key: CARD.key,
				skill: "splates",
				scenarios: ["a/one"],
				agents: [{ agent: "claude", model: "opus" }],
				baseline: null,
				reps: 1,
				conversation: "c-1",
				cwd: "/repo/tree",
				auto: true,
			},
		]);
	});

	it("runs on the agents the card names, at its repetitions", async () => {
		await autoStartEvalCard(deps, COMMANDS, {
			...CARD,
			ask: { ...CARD.ask, agents: ["codex"], reps: 3 },
		});

		expect(deps.started[0]?.agents).toEqual([{ agent: "codex" }]);
		expect(deps.started[0]?.reps).toBe(3);
	});

	it("holds the card, saying the ceiling, when the round could take the conversation past its budget", async () => {
		deps.spentSoFar = 8.5;
		deps.planned = { ...deps.planned, usd: 2 };

		expect(await autoStartEvalCard(deps, COMMANDS, CARD)).toEqual({
			short: {
				ceiling: 2,
				budget: { usd: 10, spent: 8.5, answers: {} },
			},
		});
		expect(deps.started).toEqual([]);
	});

	it("holds the card while no budget is approved", async () => {
		deps.usd = 0;

		const held = await autoStartEvalCard(deps, COMMANDS, CARD);

		expect(held !== null && "short" in held).toBe(true);
		expect(deps.started).toEqual([]);
	});

	it("starts nothing with no ceiling, a refused plan or no agent", async () => {
		deps.planned = { ...deps.planned, usd: null };
		expect(await autoStartEvalCard(deps, COMMANDS, CARD)).toBeNull();
		deps.planned = { cells: 1, usd: 1, refused: true, output: "no" };
		expect(await autoStartEvalCard(deps, COMMANDS, CARD)).toBeNull();
		deps.planned = { cells: 1, usd: 1, refused: false, output: "" };
		deps.saved = [];
		expect(await autoStartEvalCard(deps, COMMANDS, CARD)).toBeNull();
		expect(deps.started).toEqual([]);
	});

	it("never starts a card that already has a run", async () => {
		deps.existing = {
			id: "l-0",
			key: CARD.key,
			status: "done",
			batch: "b",
			output: "",
		};

		expect(await autoStartEvalCard(deps, COMMANDS, CARD)).toBeNull();
		expect(deps.started).toEqual([]);
	});
});

const COMMANDS: EvalCommands = {
	root: "/repo",
	results: "/repo/results",
	list: "list",
	run: "run",
	plan: "plan",
};

const CARD = {
	ask: { skill: "splates", scenarios: ["a/one"], baseline: null },
	key: "splates:a/one::c-1:4",
	conversation: "c-1",
	cwd: "/repo/tree",
};

class FakeDeps implements EvalAutoStartDeps {
	usd = 10;
	saved: AgentPick[] = [{ agent: "claude", model: "opus" }, { agent: "codex" }];
	spentSoFar = 0;
	planned: EvalPlan = { cells: 1, usd: 1, refused: false, output: "" };
	existing: EvalLaunch | null = null;
	started: EvalLaunchSpec[] = [];

	savedAgents = async () => this.saved;
	launches = {
		get: async () => this.existing,
		plan: async () => this.planned,
		budget: async () => ({
			usd: this.usd,
			spent: this.spentSoFar,
			answers: {},
		}),
		start: async (_: EvalCommands, spec: EvalLaunchSpec) => {
			this.started.push(spec);
			return {
				id: "l-1",
				key: spec.key,
				status: "running" as const,
				batch: null,
				output: "",
				auto: true as const,
			};
		},
	};
}

describe("evalBudgetShortPrompt", () => {
	it("asks for a first budget when none is approved", () => {
		expect(
			evalBudgetShortPrompt(2.4, { usd: 0, spent: 0, answers: {} }),
		).toContain("no eval budget approved yet. Ask for a budget");
	});

	it("asks for at least the shortfall when the budget runs short", () => {
		const said = evalBudgetShortPrompt(2.4, {
			usd: 10,
			spent: 9.2,
			answers: {},
		});

		expect(said).toContain("$0.80 left of the $10.00");
		expect(said).toContain("at least $1.60 more");
	});
});
