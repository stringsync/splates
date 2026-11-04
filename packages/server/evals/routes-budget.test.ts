import { afterEach, beforeEach, expect, it } from "bun:test";
import { join } from "node:path";
import { Testing } from "../testing";
import { EvalLaunches, type SavedLaunch } from "./launch";
import { EvalRoutes } from "./routes";

let deps: Testing;
let launches: EvalLaunches;
let directory: string;
it("links saved and earlier batches to conversation totals, leaving imports alone", async () => {
	const routes = new EvalRoutes({ directory: async () => directory, launches });
	const batches = await (
		await routes.list(new Request("http://localhost/api/evals"))
	).json();
	expect(batches).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: "first",
				conversation: "loop",
				budget: expect.objectContaining({
					budget: { usd: 7, rounds: 4 },
					roundsUsed: 2,
				}),
			}),
			expect.objectContaining({
				id: "second",
				conversation: "loop",
				budget: expect.objectContaining({
					budget: { usd: 7, rounds: 4 },
					roundsUsed: 2,
				}),
			}),
			expect.not.objectContaining({
				id: "imported",
				budget: expect.anything(),
			}),
		]),
	);
	expect(batches).toHaveLength(3);
	expect(
		batches.find((batch: { id: string }) => batch.id === "imported"),
	).not.toHaveProperty("budget");
	expect(await launches.batchConversations(join(deps.root, "other"))).toEqual(
		new Map(),
	);
});

beforeEach(async () => {
	deps = await Testing.open();
	directory = join(deps.root, "evals");
	for (const id of ["first", "second", "imported"]) {
		await Bun.write(
			join(directory, id, "batch.json"),
			JSON.stringify({
				format: "splates-evals/1",
				startedAt: "2026-10-26T12:00:00.000Z",
				cells: [{ id: "c1", case: "a/b", target: { model: "m" } }],
			}),
		);
	}
	await deps.machine
		.document<Record<string, SavedLaunch>>("eval-launches.json")
		.write({
			card: {
				commands: {
					root: deps.root,
					results: directory,
					list: null,
					run: null,
					plan: null,
				},
				spec: {
					key: "card",
					skill: "test",
					scenarios: ["a/b"],
					agents: [],
					baseline: null,
					conversation: "loop",
				},
				launch: {
					id: "launch2",
					key: "card",
					status: "done",
					batch: "second",
					output: "",
				},
			},
		});
	launches = new EvalLaunches(deps.ps, deps.machine);
	await launches.budgets.set("loop", { usd: 7, rounds: 4 });
	for (const [launch, batch] of [
		["launch1", "first"],
		["launch2", "second"],
	] as const) {
		await launches.budgets.begin("loop", { launch, batch, worstUsd: 1 });
	}
});
afterEach(async () => {
	await launches.disposeAsync();
	await deps.disposeAsync();
});
