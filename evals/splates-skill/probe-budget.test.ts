import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Probe } from "./probe";
import { DEFAULT_BUDGET } from "./probe-affordability";
import { declared, parseEvalSpend, windowStart } from "./probe-budget-policy";
import { EvalBudgets } from "./probe-budget-store";
import { loadModules } from "./probe-cli";
import { type Adapter, runProbes } from "./runner";

const exec = promisify(execFile);
let dir: string;
let path: string;
const allowance = { tokens: 1000, microUsd: 10000 };

it("requires explicit configuration and refuses unlimited, invalid and unsafe limits", async () => {
	await expect(new EvalBudgets(path).reserve([allowance])).rejects.toThrow(
		"No eval token budget",
	);
	expect(() => parseEvalSpend("unlimited")).toThrow();
	expect(() => parseEvalSpend("1/0d")).toThrow();
	expect(() => parseEvalSpend("999999999999999999999/day")).toThrow();
	expect(() => declared({ tokens: 1.5, per: "day" }, "test")).toThrow();
	expect(parseEvalSpend("2m/month,300k/7d")).toEqual([
		{ tokens: 2000000, per: "month" },
		{ tokens: 300000, within: "7d" },
	]);
});

it("shares reservations across concurrent processes and restarts without refunds", async () => {
	await new EvalBudgets(path).set(parseEvalSpend("1k/day"));
	const script = `import { EvalBudgets } from ${JSON.stringify(join(import.meta.dir, "probe-budget-store.ts"))}; await new EvalBudgets(process.argv[1]).reserve([{tokens:1000,microUsd:10000}]);`;
	const attempts = await Promise.allSettled([
		exec(process.execPath, ["-e", script, path]),
		exec(process.execPath, ["-e", script, path]),
	]);
	expect(
		attempts.filter((result) => result.status === "fulfilled"),
	).toHaveLength(1);
	const report = await new EvalBudgets(path).report();
	expect(report.reservations).toHaveLength(1);
	expect(report.windows[0]).toMatchObject({
		reserved: 1000,
		consumed: 0,
		remaining: 0,
	});
	await expect(new EvalBudgets(path).reserve([allowance])).rejects.toThrow(
		"exhausted",
	);
});

it("reset returns to config without clearing spending, and zero forbids execution", async () => {
	const budgets = new EvalBudgets(
		path,
		declared({ tokens: 1000, per: "day" }, "eval.config.ts"),
	);
	await budgets.set(parseEvalSpend("2k/day"));
	const id = await budgets.reserve([allowance]);
	await budgets.finish(id, [{ tokens: 200, costUsd: 0.001 }], true);
	await budgets.set(undefined);
	expect((await budgets.report()).windows[0]).toMatchObject({
		consumed: 1000,
		reserved: 0,
		remaining: 0,
	});
	expect((await budgets.report()).from).toBe("eval.config.ts");
	await budgets.set("nothing");
	await expect(budgets.reserve([allowance])).rejects.toThrow("exhausted");
	await budgets.set(undefined);
	await expect(budgets.reserve([allowance])).rejects.toThrow("exhausted");
});

it("keeps unknown and active usage through calendar and rolling resets; known completion ages from finish", async () => {
	let now = new Date(2026, 9, 17, 23, 59).getTime();
	const budgets = new EvalBudgets(
		path,
		declared(
			[
				{ tokens: 3000, per: "day" },
				{ tokens: 3000, within: "24h" },
			],
			"test",
		),
		() => now,
	);
	const known = await budgets.reserve([allowance]);
	const unknown = await budgets.reserve([allowance]);
	now += 120000;
	await budgets.finish(known, [{ tokens: 10, costUsd: 0.0001 }], true);
	await budgets.finish(unknown, [{ tokens: null, costUsd: null }], true);
	expect(
		(await budgets.report()).windows.map((item) => item.remaining),
	).toEqual([1000, 1000]);
	now += 2 * 86400000;
	expect(
		(await budgets.report()).windows.map((item) => item.remaining),
	).toEqual([2000, 2000]);
	expect((await budgets.report()).reservations[1]?.finished).toBeNull();
});

it("uses Scry local Monday/week and month boundaries, and check resets per invocation", async () => {
	const now = new Date(2026, 9, 18, 13).getTime();
	expect(windowStart({ per: "week" }, now)).toBe(
		new Date(2026, 9, 12).getTime(),
	);
	expect(windowStart({ per: "month" }, now)).toBe(
		new Date(2026, 9, 1).getTime(),
	);
	const budgets = new EvalBudgets(
		path,
		declared({ tokens: 1000, per: "check" }, "test"),
	);
	await budgets.reserve([allowance]);
	await budgets.reserve([allowance]);
	await expect(budgets.reserve([allowance, allowance])).rejects.toThrow(
		"exhausted",
	);
});

it("fails closed on corrupt state and preserves reservations when usage is malformed", async () => {
	const budgets = new EvalBudgets(
		path,
		declared({ tokens: 1000, per: "day" }, "test"),
	);
	const id = await budgets.reserve([allowance]);
	await expect(
		budgets.finish(id, [{ tokens: -1, costUsd: null }], false),
	).rejects.toThrow();
	expect((await budgets.report()).windows[0]?.reserved).toBe(1000);
	await writeFile(path, '{"schema":2,"entries":[]}');
	await expect(budgets.reserve([allowance])).rejects.toThrow();
	expect(await readFile(path, "utf8")).toBe('{"schema":2,"entries":[]}');
});

// scry-ignore simple-test-setup: this free transport boundary owns the launch counter and intentionally unknown failure usage.
it("reserves all concurrent jobs before seeds, retains failures/retries, and refuses the next invocation", async () => {
	const loaded = await loadModules([]);
	const probe = loaded.probes.find(
		(item) => item.id === "continuity/checkpoint",
	) as Probe;
	const budgets = new EvalBudgets(
		path,
		declared({ tokens: 2000, per: "day" }, "test"),
	);
	let launches = 0;
	const adapter: Adapter = {
		id: "free",
		version: "1",
		config: {},
		tokenBound: true,
		async run() {
			throw new Error("unbounded path");
		},
		metering: {
			quote: () => allowance,
			async run(context, _model, reserved) {
				expect((await budgets.report()).windows[0]?.reserved).toBe(2000);
				expect(reserved).toEqual(allowance); // Includes ALL retries; no new allowance per attempt.
				launches++;
				context.trace({ freeAttempt: 1 });
				context.trace({ freeAttempt: 2 });
				throw new Error("free transport failed after possible usage");
			},
		},
	};
	const module = {
		probes: [probe],
		seeds: [
			{
				id: probe.seed.id,
				version: probe.seed.version,
				fingerprint: "free",
				async prepare() {
					expect((await budgets.report()).windows[0]?.reserved).toBe(2000);
				},
				async observe() {
					return {};
				},
			},
		],
	};
	const options = {
		directory: join(dir, "runs"),
		parallel: 2,
		reps: 2,
		skillHash: "free",
		cliHash: "free",
		reproduction: [],
		budget: DEFAULT_BUDGET,
		sharedBudget: budgets,
	};
	const runs = await runProbes(module, [{ adapter, model: "free" }], options);
	expect(launches).toBe(2);
	expect(
		runs.every((run) => run.result.status === "infrastructure-error"),
	).toBe(true);
	expect((await budgets.report()).reservations[0]?.finished).toBeNull();
	await expect(
		runProbes(module, [{ adapter, model: "free" }], options),
	).rejects.toThrow("exhausted");
	expect(launches).toBe(2);
	const fresh = new EvalBudgets(
		join(dir, "fresh.json"),
		declared({ tokens: 2000, per: "day" }, "test"),
	);
	const unknown = {
		...adapter,
		metering: {
			quote: () => null,
			run: adapter.metering?.run as NonNullable<Adapter["metering"]>["run"],
		},
	};
	await expect(
		runProbes(module, [{ adapter: unknown, model: "free" }], {
			...options,
			sharedBudget: fresh,
		}),
	).rejects.toThrow("Unknown metering");
	expect((await fresh.report()).reservations).toEqual([]);
	await writeFile(join(dir, "not-directory"), "blocked");
	await expect(
		runProbes(module, [{ adapter, model: "free" }], {
			...options,
			sharedBudget: new EvalBudgets(
				join(dir, "not-directory/ledger"),
				declared({ tokens: 2000, per: "day" }, "test"),
			),
		}),
	).rejects.toThrow();
	expect(launches).toBe(2);
	const cancelled = await runProbes(module, [{ adapter, model: "free" }], {
		...options,
		sharedBudget: fresh,
		signal: AbortSignal.abort(),
	});
	expect(cancelled.map((run) => run.run.evidence.termination)).toEqual([
		"bound",
		"bound",
	]);
	expect((await fresh.report()).windows[0]?.reserved).toBe(2000);
	expect(launches).toBe(2);
});

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "eval-budget-"));
	path = join(dir, "eval-budgets.json");
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

it("budget CLI config precedence and reset preserve history without contacting a provider", async () => {
	const script = `import { evalBudgetCli } from ${JSON.stringify(join(import.meta.dir, "probe-budget-cli.ts"))}; await evalBudgetCli(JSON.parse(process.argv[1]), process.argv[2], {info: console.log});`;
	const env = {
		...process.env,
		HOME: dir,
		XDG_CONFIG_HOME: join(dir, "config"),
		XDG_STATE_HOME: join(dir, "state"),
	};
	const call = async (args: string[]) =>
		JSON.parse(
			(
				await exec(
					process.execPath,
					["-e", script, JSON.stringify([...args, "--format", "json"]), dir],
					{ env },
				)
			).stdout,
		);
	await writeFile(
		join(dir, "eval.config.ts"),
		'export default { budgets: { tokens: 1000, per: "day" } };',
	);
	expect((await call([])).spend).toBe("1k/day");
	const { mkdir } = await import("node:fs/promises");
	await mkdir(join(dir, "config/eval"), { recursive: true });
	await writeFile(
		join(dir, "config/eval/config.ts"),
		'export default { budgets: { tokens: 2000, per: "day" } };',
	);
	expect((await call([])).spend).toBe("2k/day");
	expect((await call(["set", "3k/day"])).spend).toBe("3k/day");
	expect((await call(["reset"])).spend).toBe("2k/day");
	await expect(call(["set", "unlimited"])).rejects.toThrow();
	expect((await call([])).spend).toBe("2k/day");
});
