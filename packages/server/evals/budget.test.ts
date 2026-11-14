import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Testing } from "../testing";
import { type EvalCommands, EvalLaunches } from "./launch";

describe("eval budget", () => {
	let deps: Testing;
	let launches: EvalLaunches;
	let commands: EvalCommands;

	beforeEach(async () => {
		deps = await Testing.open();
		const root = join(deps.root, "project");
		const results = join(deps.root, "evals");
		await mkdir(root, { recursive: true });
		await mkdir(results, { recursive: true });
		commands = {
			root,
			results,
			list: null,
			run: "true",
			plan: `echo '{"cells":9,"usd":4}'`,
		};
		launches = new EvalLaunches(deps.ps, deps.machine);
	});

	afterEach(async () => {
		await launches.disposeAsync();
		await deps.disposeAsync();
	});

	const spec = (key: string) => ({
		key,
		skill: "s",
		scenarios: ["a"],
		agents: [{ agent: "claude" }],
		baseline: null,
		conversation: "c-1",
	});

	it("never refuses a run: each is its own round with its own budget", async () => {
		await launches.budgets.set("c-1", { usd: 1 });
		await launches.start(commands, spec("one"));
		const second = await launches.start(commands, spec("two"));
		expect(second.status).toBe("running");
		expect(await launches.budgets.roundsOf("c-1")).toHaveLength(2);
	});

	it("counts a run with no recorded cost as spending nothing yet", async () => {
		await launches.start(commands, spec("one"));
		expect(await launches.budgetStatus(commands, "c-1")).toEqual({
			budget: { usd: 10 },
			spentUsd: 0,
			tokens: 0,
		});
	});

	it("takes the budget of the run it starts, the next card starting with it", async () => {
		await launches.budgets.set("c-1", { usd: 2 });
		await launches.budgets.set("c-1", { usd: 99 });
		expect(await launches.budgets.budgetOf("c-1")).toEqual({ usd: 99 });
		await launches.start(commands, spec("one"));
		expect(await launches.budgetStatus(commands, "c-1")).toMatchObject({
			budget: { usd: 99 },
		});
	});
});
