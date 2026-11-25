import { beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	EvalCommands,
	EvalLaunches,
	EvalLaunchSpec,
	EvalScenario,
} from "./launch";
import { EvalLaunchRoutes } from "./launch-routes";
import type { EvalOrderedScenario } from "./order";

const plan = (sent: Record<string, unknown>) =>
	new Request("http://localhost/api/evals/plan", {
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
	let planned: Omit<EvalLaunchSpec, "key">[];
	let listed: EvalScenario[];
	let launches: EvalLaunches;
	let commands: EvalCommands | null;
	let routes: EvalLaunchRoutes;
	let cwds: Map<string, string>;

	beforeEach(() => {
		cwds = new Map();
		planned = [];
		listed = [];
		commands = COMMANDS;
		launches = {
			async scenarios() {
				return listed;
			},
			async plan(_: EvalCommands, spec: Omit<EvalLaunchSpec, "key">) {
				planned.push(spec);
				return { cells: 1, usd: 1, refused: false, output: "" };
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
	};

	it("plans the run its card names", async () => {
		const sent = { ...ask, baseline: "fd9f3785" };

		const response = await routes.plan(plan(sent));

		expect(response.status).toBe(200);
		expect(planned).toMatchObject([{ ...sent, cwd: null }]);
	});

	it("plans where the conversation works, when that directory is there", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "eval-routes-test-"));
		cwds.set("c-1", cwd);
		cwds.set("c-gone", join(cwd, "gone"));

		await routes.plan(plan({ ...ask, conversation: "c-1" }));
		await routes.plan(plan({ ...ask, conversation: "c-gone" }));
		await routes.plan(plan({ ...ask, conversation: "c-2" }));
		await rm(cwd, { recursive: true, force: true });

		expect(planned.map((each) => each.cwd)).toEqual([cwd, null, null]);
	});

	it("refuses a plan for a project that names no run command", async () => {
		commands = { ...COMMANDS, run: null };

		expect(routes.plan(plan(ask))).rejects.toThrow("evals.run");
		expect(planned).toEqual([]);
	});

	it("refuses a plan for a project that names no evals", async () => {
		commands = null;

		expect(routes.plan(plan(ask))).rejects.toThrow("names no evals");
	});

	it("lists single scenarios in run order and scopes last run by ?agent=", async () => {
		const results = await mkdtemp(join(tmpdir(), "eval-order-routes-"));
		try {
			commands = { ...COMMANDS, results };
			listed = [
				{ id: "low-never", group: null, about: null, priority: "low" },
				{ id: "ran-codex", group: null, about: null },
				{ id: "high-old", group: null, about: null, priority: "high" },
				{ id: "ran-claude", group: null, about: null },
			];
			await mkdir(join(results, "b1"), { recursive: true });
			await Bun.write(
				join(results, "b1", "batch.json"),
				JSON.stringify({
					format: "splates-evals/1",
					startedAt: "2026-11-01T00:00:00.000Z",
					cells: [
						{ id: "c1", case: "high-old", target: { agent: "claude" } },
						{ id: "c2", case: "ran-claude", target: { agent: "claude" } },
					],
				}),
			);
			await Bun.write(
				join(results, "b1", "results.jsonl"),
				`${[
					JSON.stringify({ cell: "c1", status: "pass" }),
					JSON.stringify({ cell: "c2", status: "pass" }),
				].join("\n")}\n`,
			);
			await mkdir(join(results, "b2"), { recursive: true });
			await Bun.write(
				join(results, "b2", "batch.json"),
				JSON.stringify({
					format: "splates-evals/1",
					startedAt: "2026-11-10T00:00:00.000Z",
					cells: [{ id: "c3", case: "ran-codex", target: { agent: "codex" } }],
				}),
			);
			await Bun.write(
				join(results, "b2", "results.jsonl"),
				`${JSON.stringify({ cell: "c3", status: "pass" })}\n`,
			);

			const all = (await (
				await routes.order(new Request("http://localhost/api/evals/order"))
			).json()) as EvalOrderedScenario[];
			expect(
				all.map((each) => [each.id, each.priority, each.lastRunAt]),
			).toEqual([
				["high-old", "high", "2026-11-01T00:00:00.000Z"],
				["ran-claude", "normal", "2026-11-01T00:00:00.000Z"],
				["ran-codex", "normal", "2026-11-10T00:00:00.000Z"],
				["low-never", "low", null],
			]);

			const claudeOnly = (await (
				await routes.order(
					new Request("http://localhost/api/evals/order?agent=claude"),
				)
			).json()) as EvalOrderedScenario[];
			expect(claudeOnly.map((each) => [each.id, each.lastRunAt])).toEqual([
				["high-old", "2026-11-01T00:00:00.000Z"],
				["ran-codex", null],
				["ran-claude", "2026-11-01T00:00:00.000Z"],
				["low-never", null],
			]);
		} finally {
			await rm(results, { recursive: true, force: true });
		}
	});
});
