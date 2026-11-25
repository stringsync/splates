import { afterEach, beforeEach, expect, it } from "bun:test";
import { join } from "node:path";
import { Testing } from "../testing";
import { EvalLaunches, type SavedLaunch } from "./launch";
import { EvalRoutes } from "./routes";

let deps: Testing;
let launches: EvalLaunches;
it("links saved and earlier batches to their conversation, leaving imports alone", async () => {
	const directory = join(deps.root, "evals");
	const routes = new EvalRoutes({ directory: async () => directory, launches });
	const batches = await (
		await routes.list(new Request("http://localhost/api/evals"))
	).json();
	const owner = (id: string) =>
		batches.find((batch: { id: string }) => batch.id === id)?.conversation;
	expect(batches).toHaveLength(3);
	expect(owner("first")).toBe("loop");
	expect(owner("second")).toBe("loop");
	expect(owner("imported")).toBeUndefined();
	expect(batches[0]).not.toHaveProperty("budget");
	expect(await launches.batchConversations(join(deps.root, "other"))).toEqual(
		new Map(),
	);
});

it("drops a refused round and notes a landed one's batch", async () => {
	await launches.rounds.begin("other", { launch: "a", batch: null });
	await launches.rounds.begin("other", { launch: "b", batch: null });
	await launches.rounds.landed("other", "a", "batch-a");
	await launches.rounds.drop("other", "b");
	expect(await launches.rounds.roundsOf("other")).toEqual([
		{ launch: "a", batch: "batch-a" },
	]);
});

it("reads rounds a budgeted record kept before", async () => {
	await deps.machine.document("eval-budgets.json").write({
		old: { usd: 7, runs: [{ launch: "x", worstUsd: 1, batch: "b" }] },
	});
	const fresh = new EvalLaunches(deps.ps, deps.machine);
	expect((await fresh.rounds.roundsOf("old"))[0]?.batch).toBe("b");
	await fresh.disposeAsync();
});

beforeEach(async () => {
	deps = await Testing.open();
	const directory = join(deps.root, "evals");
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
	for (const [launch, batch] of [
		["launch1", "first"],
		["launch2", "second"],
	] as const) {
		await launches.rounds.begin("loop", { launch, batch });
	}
});
afterEach(async () => {
	await launches.disposeAsync();
	await deps.disposeAsync();
});
