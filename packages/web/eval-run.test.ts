import { beforeEach, describe, expect, it } from "bun:test";
import {
	type EvalGrid,
	type EvalLaunch,
	evalCardKey,
} from "@splates/server/evals/browser";
import type { AgentPick } from "@splates/server/models";
import { FakeTimer } from "core/time/testing";
import { EvalRun, type EvalRunServer, forgetShownEvals } from "./eval-run";

describe("EvalRun", () => {
	const proposal = () => ({
		action: "run-evals" as const,
		lane: null,
		tasks: [],
		title: null,
		body: "",
		evals: ASK,
	});
	let server: FakeEvalServer;
	let timer: FakeTimer;

	beforeEach(() => {
		forgetShownEvals();
		server = new FakeEvalServer();
		timer = new FakeTimer();
	});

	it("keys identical proposals by their card, stable across reloads", () => {
		const first = EvalRun.of(proposal(), {
			server,
			timer,
			conversation: "c-1",
			message: "m-1",
		});
		const reloaded = EvalRun.of(proposal(), {
			server,
			timer,
			conversation: "c-1",
			message: "m-1",
		});
		const resent = EvalRun.of(proposal(), {
			server,
			timer,
			conversation: "c-1",
			message: "m-2",
		});

		expect(reloaded.key).toBe(first.key);
		expect(resent.key).not.toBe(first.key);
	});

	it("ticks only the first saved agent when the card names no Agents line", async () => {
		const run = EvalRun.of(proposal(), { server, timer });

		await run.load();

		expect(run.picks).toEqual([{ agent: "claude", model: "opus" }]);
		run.dispose();
	});
	it("ticks only the agents the card names and flags the ones not saved", async () => {
		const run = EvalRun.of(
			{ ...proposal(), evals: { ...ASK, agents: ["codex", "claude:gone"] } },
			{ server, timer },
		);

		await run.load();

		expect(run.picks).toEqual([{ agent: "codex" }]);
		expect(run.unknownAgents).toEqual(["claude:gone"]);
		run.dispose();
	});
	it("groups the scenarios and plans on the saved agents without starting", async () => {
		const run = EvalRun.of(proposal(), { server, timer });

		await run.load();

		expect(run.groups.map((each) => each.group)).toEqual([
			"decisions",
			"lifecycle",
		]);
		expect(run.plan?.usd).toBe(8);
		expect(run.launch).toBeNull();
	});

	it("publishes an ongoing run only after its progress has loaded", async () => {
		server.launched = {
			id: "1",
			key: "run-key",
			status: "running",
			batch: "batch-a",
			output: "",
		};
		const run = EvalRun.of(proposal(), { server, timer });
		const shown: {
			loaded: boolean;
			status: string | undefined;
			cells: number | undefined;
		}[] = [];
		run.events.on("changed", () => {
			shown.push({
				loaded: run.loaded,
				status: run.launch?.status,
				cells: run.grid?.cells,
			});
		});

		await run.load();

		expect(shown).toEqual([
			{ loaded: false, status: "running", cells: 4 },
			{ loaded: true, status: "running", cells: 4 },
		]);
	});

	it("reads the conversation's approved eval budget and what it spent", async () => {
		const run = EvalRun.of(proposal(), {
			server,
			timer,
			conversation: "c-1",
			message: "4",
		});
		await run.load();

		expect(run.budget).toEqual({ usd: 10, spent: 2, answers: {} });
	});

	it("names its card by the key the server starts a round under", () => {
		const run = EvalRun.of(proposal(), {
			server,
			conversation: "c-1",
			message: "4",
		});

		expect(run.key).toBe(
			evalCardKey(
				{ skill: run.ask.skill, scenarios: run.ask.scenarios },
				proposal().title,
				"c-1",
				"4",
			),
		);
	});

	it("shows a reopened card as it was while reading it again", async () => {
		server.launched = {
			id: "1",
			key: "run-key",
			status: "running",
			batch: "batch-a",
			output: "",
		};
		const opts = { server, timer, conversation: "c-9", message: "m-9" };
		await EvalRun.of(proposal(), opts).load();

		const reopened = EvalRun.of(proposal(), opts);

		expect(reopened.loaded).toBe(true);
		expect(reopened.launch?.status).toBe("running");
		expect(reopened.grid?.cells).toBe(4);
	});

	it("never starts a round itself: it waits for the server's, then follows it until it ends", async () => {
		const run = EvalRun.of(proposal(), { server, timer, conversation: "c-1" });
		await run.load();
		expect(run.launch).toBeNull();

		// The server starts the round a moment after the turn ends, within the budget.
		server.launched = {
			id: "1",
			key: run.key,
			status: "running",
			batch: "batch-a",
			output: "",
			auto: true,
		};
		timer.fireIntervals();
		await settle();
		expect(run.running).toBe(true);
		expect(run.grid?.tally.pending).toBe(2);

		server.pending = 0;
		server.launched = { ...server.launched, status: "done" };
		timer.fireIntervals();
		await settle();

		expect(run.running).toBe(false);
		expect(run.grid?.tally.pass).toBe(4);
		run.dispose();
	});
});

const ASK = {
	skill: "splates",
	scenarios: ["decisions/local-choice", "lifecycle/merge"],
	baseline: null,
};

class FakeEvalServer implements EvalRunServer {
	agents: AgentPick[] = [
		{ agent: "claude", model: "opus" },
		{ agent: "codex" },
	];
	launched: EvalLaunch | null = null;
	pending = 2;

	async savedAgents() {
		return { agents: this.agents };
	}
	async scenarios() {
		return [
			{
				id: "decisions/local-choice",
				group: "decisions",
				about: "r1",
			},
			{
				id: "lifecycle/merge",
				group: "lifecycle",
				about: "r2",
			},
		];
	}
	async plan() {
		return { cells: 4, usd: 8, refused: false, output: "" };
	}
	async launch() {
		return this.launched;
	}
	async stop() {
		if (this.launched !== null) {
			this.launched = { ...this.launched, status: "stopped" };
		}
	}
	budgetView = { usd: 10, spent: 2, answers: {} };
	async budget() {
		return this.budgetView;
	}
	async batch(): Promise<EvalGrid> {
		return {
			id: "batch-a",
			skill: "splates",
			producer: "splates",
			startedAt: "",
			targets: [],
			tally: { pass: 4 - this.pending, pending: this.pending },
			cells: 4,
			tokens: 10,
			costUsd: 0.5,
			results: [],
			grid: [],
		};
	}
}

/** Lets the reads a timer tick starts come back. */
async function settle(): Promise<void> {
	for (let each = 0; each < 5; each++) {
		await Promise.resolve();
	}
	await new Promise((resolve) => setTimeout(resolve, 0));
}
