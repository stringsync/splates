import { beforeEach, describe, expect, it } from "bun:test";
import type {
	EvalGrid,
	EvalLaunch,
} from "@stringsync/splates-server/evals/browser";
import { FakeTimer } from "webappwiz/time/testing";
import { EvalRun, type EvalRunServer } from "./eval-run";

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
		server = new FakeEvalServer();
		timer = new FakeTimer();
	});

	it("groups the probes and plans on the saved agents without starting", async () => {
		const run = EvalRun.of(proposal(), { server, timer });

		await run.load();

		expect(run.groups.map((each) => each.aspect)).toEqual([
			"decisions",
			"lifecycle",
		]);
		expect(run.plan?.usd).toBe(8);
		expect(server.started).toEqual([]);
	});

	it("starts only on run, with the agents left in and its conversation, and follows until it ends", async () => {
		const run = EvalRun.of(proposal(), { server, timer, conversation: "c-1" });
		await run.load();
		await run.toggle(1);

		await run.run();
		expect(server.started).toEqual([
			{
				...ASK,
				agents: [{ agent: "claude", model: "opus" }],
				conversation: "c-1",
			},
		]);
		expect(run.grid?.tally.pending).toBe(2);

		server.pending = 0;
		server.launched = { ...(server.launched as EvalLaunch), status: "done" };
		timer.fireIntervals();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(run.running).toBe(false);
		expect(run.grid?.tally.pass).toBe(4);
	});
});

const ASK = {
	skill: "splates",
	probes: ["decisions/local-choice", "lifecycle/merge"],
	baseline: null,
};

class FakeEvalServer implements EvalRunServer {
	started: unknown[] = [];
	launched: EvalLaunch | null = null;
	pending = 2;

	async savedAgents() {
		return [{ agent: "claude", model: "opus" }, { agent: "codex" }];
	}
	async probes() {
		return [
			{
				id: "decisions/local-choice",
				aspect: "decisions",
				requirement: "r1",
				kind: "agent",
			},
			{
				id: "lifecycle/merge",
				aspect: "lifecycle",
				requirement: "r2",
				kind: "agent",
			},
		];
	}
	async plan() {
		return { cells: 4, usd: 8, output: "" };
	}
	async start(key: string, run: unknown) {
		this.started.push(run);
		this.launched = {
			id: "1",
			key,
			status: "running",
			batch: "batch-a",
			output: "",
		};
		return this.launched;
	}
	async launch() {
		return this.launched;
	}
	async stop() {
		if (this.launched !== null) {
			this.launched = { ...this.launched, status: "stopped" };
		}
	}
	async batch(): Promise<EvalGrid> {
		return {
			id: "batch-a",
			skill: "splates",
			startedAt: "",
			targets: [],
			tally: { pass: 4 - this.pending, pending: this.pending },
			cells: 4,
			tokens: 10,
			costUsd: 0.5,
			grid: [],
		};
	}
}
