import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Exit } from "../exit";
import { Testing } from "../testing";
import { gate } from "./budget";
import { type EvalCommands, EvalLaunches } from "./launch";

describe("eval budget", () => {
	const budget = { usd: 10, rounds: 3 };

	it("lets a run that fits through", () => {
		expect(gate(budget, 5, 1, 4.95)).toEqual({ ok: true });
		expect(gate(budget, 8.95, 1, 1.05)).toEqual({ ok: true });
	});

	it("stops a run that does not fit the dollars left", () => {
		const verdict = gate(budget, 9.45, 1, 1.05);
		expect(verdict).toMatchObject({ ok: false, limit: "usd" });
	});

	it("stops at the round cap whatever is left to spend", () => {
		expect(gate(budget, 0, 3, 1)).toMatchObject({ ok: false, limit: "rounds" });
	});

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

	const spec = (key: string, auto = true) => ({
		key,
		skill: "s",
		scenarios: ["a"],
		agents: [{ agent: "claude" }],
		baseline: null,
		conversation: "c-1",
		auto,
	});

	const refusal = async (promise: Promise<unknown>) => {
		const error = await promise.then(
			() => null,
			(each: unknown) => each,
		);
		expect(error).toBeInstanceOf(Exit);
		return error as Exit;
	};

	it("counts a run with no recorded cost at its plan's worst case", async () => {
		await launches.start(commands, spec("one"));
		await launches.start(commands, spec("two"));
		// $4 + $4 spent as worst cases; a third $4 is $12 over $10.
		const error = await refusal(launches.start(commands, spec("three")));
		expect(error.reason).toBe("budget_exhausted");
		expect(error.data).toEqual({ limit: "usd" });
	});

	it("stops at the round cap", async () => {
		await launches.budgets.set("c-1", { usd: 100, rounds: 1 });
		await launches.start(commands, spec("one"));
		const error = await refusal(launches.start(commands, spec("two")));
		expect(error.data).toEqual({ limit: "rounds" });
	});

	it("does not gate the person's own press", async () => {
		await launches.budgets.set("c-1", { usd: 1, rounds: 1 });
		await launches.start(commands, spec("one", false));
		await launches.start(commands, spec("two", false));
	});

	it("keeps the budget it was first given", async () => {
		await launches.budgets.set("c-1", { usd: 2, rounds: 1 });
		expect(await launches.budgets.set("c-1", { usd: 99, rounds: 9 })).toEqual({
			usd: 2,
			rounds: 1,
		});
		expect(await launches.budgets.budgetOf("c-1")).toEqual({
			usd: 2,
			rounds: 1,
		});
	});

	it("reports spend, rounds and the limit that stopped the loop", async () => {
		await launches.budgets.set("c-1", { usd: 100, rounds: 1 });
		expect(await launches.budgetStatus(commands, "c-1")).toMatchObject({
			roundsUsed: 0,
			spentUsd: 0,
			stoppedBy: null,
		});
		await launches.start(commands, spec("one"));
		expect(await launches.budgetStatus(commands, "c-1")).toMatchObject({
			budget: { usd: 100, rounds: 1 },
			roundsUsed: 1,
			spentUsd: 4,
			stoppedBy: "rounds",
		});
	});
});
