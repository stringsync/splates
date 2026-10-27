import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalCommands, EvalLaunches, EvalLaunchSpec } from "./launch";
import { EvalLaunchRoutes } from "./launch-routes";

const launch = (sent: Record<string, unknown>) =>
	new Request("http://localhost/api/evals/launch", {
		method: "POST",
		body: JSON.stringify(sent),
	});

const COMMANDS: EvalCommands = {
	root: "/repo",
	results: "/repo/.evals",
	list: "list",
	run: "run",
	plan: null,
};

describe("EvalLaunchRoutes", () => {
	let started: EvalLaunchSpec[];
	let launches: EvalLaunches;
	let commands: EvalCommands | null;
	let routes: EvalLaunchRoutes;
	let cwds: Map<string, string>;

	beforeEach(() => {
		cwds = new Map();
		started = [];
		commands = COMMANDS;
		launches = {
			async start(_: EvalCommands, spec: EvalLaunchSpec) {
				started.push(spec);
				return spec;
			},
		} as unknown as EvalLaunches;
		routes = new EvalLaunchRoutes(
			launches,
			{ commandsOf: async () => commands },
			{
				cwdOf: async (id) => cwds.get(id) ?? null,
			},
		);
	});

	const ask = {
		skill: "splates",
		scenarios: ["resources/install"],
		agents: [{ agent: "claude" }],
		key: "card-1",
	};

	it("starts the run its card names from the one body the Run button sends", async () => {
		const sent = { ...ask, baseline: "fd9f3785" };

		const response = await routes.start(launch(sent));

		expect(response.status).toBe(200);
		expect(started).toEqual([{ ...sent, conversation: null, cwd: null }]);
	});

	it("runs where the conversation works, when that directory is there", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "eval-routes-test-"));
		cwds.set("c-1", cwd);
		cwds.set("c-gone", join(cwd, "gone"));

		await routes.start(launch({ ...ask, conversation: "c-1" }));
		await routes.start(launch({ ...ask, conversation: "c-gone" }));
		await routes.start(launch({ ...ask, conversation: "c-2" }));
		await rm(cwd, { recursive: true, force: true });

		expect(started.map((each) => [each.conversation, each.cwd])).toEqual([
			["c-1", cwd],
			["c-gone", null],
			["c-2", null],
		]);
	});

	it("refuses a run for a project that names no run command", async () => {
		commands = { ...COMMANDS, run: null };

		await expect(routes.start(launch(ask))).rejects.toThrow("evals.run");
		expect(started).toEqual([]);
	});

	it("refuses a run for a project that names no evals", async () => {
		commands = null;

		await expect(routes.start(launch(ask))).rejects.toThrow("names no evals");
	});
});
