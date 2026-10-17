import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT, FakeAgent } from "@webappwiz/arbor/testing/agent";
import type { Probe } from "./probe";
import { acpAdapter, cliAdapter, launchIsolated } from "./probe-adapters";
import { comparisonKey, probeReport } from "./probe-report";
import {
	type Adapter,
	hash,
	type RunOptions,
	readRun,
	runProbes,
	type Seed,
	type StoredRun,
	validate,
} from "./runner";

let testDirectory: string;
beforeEach(async () => {
	testDirectory = await mkdtemp(join(tmpdir(), "probe-runner-test-"));
});
afterEach(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

// scry-ignore simple-test-setup: concurrency counters and port leases belong only to this scheduling test.
it("runs combinations with bounded parallelism, fresh paths/ports and immediate feedback", async () => {
	let active = 0,
		maximum = 0,
		disposed = 0;
	const homes = new Set<string>();
	const ports = new Set<number>();
	const completed: string[] = [];
	const observed = adapter(async (context, model) => {
		active++;
		maximum = Math.max(maximum, active);
		homes.add(context.isolation.arborHome);
		ports.add(context.listen(() => new Response("isolated")));
		context.cleanup(() => {
			disposed++;
		});
		await new Promise((resolve) =>
			setTimeout(resolve, model === "slow" ? 30 : 2),
		);
		context.usage.turns = 1;
		context.usage.tokens = 5;
		context.reply("done");
		active--;
	});
	const opts = await options({
		reps: 2,
		completed: (value, path) => {
			completed.push(value.run.identity.model ?? "");
			expect(path.endsWith("result.json")).toBe(true);
		},
	});
	const results = await runProbes(
		{ probes: [probe(), probe({ id: "other" })], seeds: [seed] },
		[
			{ adapter: observed, model: "slow" },
			{ adapter: observed, model: "fast" },
		],
		opts,
	);
	expect(results).toHaveLength(8);
	expect(maximum).toBe(2);
	expect(homes.size).toBe(8);
	expect(ports.size).toBe(8);
	expect(disposed).toBe(8);
	expect(completed).toHaveLength(8);
	expect(results.every((value) => value.result.status === "pass")).toBe(true);
	expect(results.every((value) => value.overheadMs >= 0)).toBe(true);
	const first = results[0] as StoredRun;
	const stored = await readRun(
		join(first.run.isolation.outputs, "..", "result.json"),
	);
	expect(stored.run.identity).toEqual(first.run.identity);
	expect(first.run.reproduction).toContain("fake:slow");
	expect(first.run.usage.milliseconds).toBeGreaterThan(0);
});

it("starts the next combination without waiting for a slow peer", async () => {
	const order: string[] = [];
	const results = await runProbes(
		{ probes: [probe()], seeds: [seed] },
		["slow", "fast", "next"].map((model) => ({
			model,
			adapter: adapter(async (context) => {
				order.push(model);
				await new Promise((resolve) =>
					setTimeout(resolve, model === "slow" ? 30 : 1),
				);
				context.reply("done");
			}),
		})),
		await options(),
	);
	expect(results[0]?.run.identity.model).toBe("fast");
	expect(order.slice(0, 2).sort()).toEqual(["fast", "slow"]);
	expect(order[2]).toBe("next");
});

it("keeps bound, infrastructure-error, unsupported and assertion failures in reports", async () => {
	const targets = [
		{ model: "hang", adapter: adapter(async () => new Promise(() => {})) },
		{
			model: "error",
			adapter: adapter(async () => {
				throw new Error("broken fixture");
			}),
		},
		{ model: "unsupported", adapter: { ...adapter(), tokenBound: false } },
		{
			model: "fail",
			adapter: adapter(async (context) => context.reply("done")),
		},
	];
	const results = await runProbes(
		{
			probes: [
				probe({
					bounds: { milliseconds: 40, turns: 1, tokens: 100 },
					assertions: [
						{ id: "wrong", kind: "state", key: "seeded", equals: false },
					],
				}),
			],
			seeds: [seed],
		},
		targets,
		await options({ parallel: 4 }),
	);
	expect(results.map((value) => value.result.status).sort()).toEqual([
		"bound",
		"fail",
		"infrastructure-error",
		"unsupported",
	]);
	const report = probeReport(results);
	expect(report).toContain("bound:1");
	expect(report).toContain("fail:1");
	expect(report).toContain("infrastructure-error:1");
	expect(report).toContain("unsupported:1");
	expect(report).toContain("expected false; actual true");
	expect(report).toContain("unknown");
});

// scry-ignore simple-test-setup: this test alone owns an external cancellation controller and counts queued launches.
it("cancels active work and records queued runs without launching them", async () => {
	const controller = new AbortController();
	let launched = 0,
		disposed = 0;
	const target = adapter(async (context) => {
		launched++;
		context.cleanup(() => {
			disposed++;
		});
		controller.abort();
		await new Promise(() => {});
	});
	const results = await runProbes(
		{ probes: [probe()], seeds: [seed] },
		[{ adapter: target, model: "fake" }],
		await options({ reps: 3, parallel: 1, signal: controller.signal }),
	);
	expect(launched).toBe(1);
	expect(disposed).toBe(1);
	expect(results).toHaveLength(3);
	expect(results.every((value) => value.result.status === "bound")).toBe(true);
});

it("stops on an actual matching event and preserves prior violations", async () => {
	const event = {
		actor: "agent" as const,
		kind: "command" as const,
		name: "arbor",
		args: ["merge"],
		exitCode: 0,
	};
	const results = await runProbes(
		{
			probes: [
				probe({
					stop: { kind: "event", match: event },
					assertions: [
						{
							id: "forbidden",
							kind: "count",
							match: { ...event, args: ["remove"] },
							min: 0,
							max: 0,
						},
					],
				}),
			],
			seeds: [seed],
		},
		[
			{
				model: "fake",
				adapter: adapter(async (context) => {
					context.evidence.complete.push("events");
					context.emit({ ...event, id: "1", args: ["remove"] });
					context.emit({ ...event, id: "2" });
					context.emit({ ...event, id: "3" });
				}),
			},
		],
		await options(),
	);
	expect(results[0]?.result.status).toBe("fail");
	expect(results[0]?.run.evidence.events).toHaveLength(2);
});

it("does not mistake missing events or premature adapter exit for a pass", async () => {
	const results = await runProbes(
		{
			probes: [
				probe({
					assertions: [
						{
							id: "forbidden",
							kind: "count",
							match: { actor: "agent", kind: "command", name: "arbor" },
							min: 0,
							max: 0,
						},
					],
				}),
			],
			seeds: [seed],
		},
		[
			{ model: "done", adapter: adapter() },
			{ model: "early", adapter: adapter(async () => {}) },
		],
		await options(),
	);
	expect(
		results.find((value) => value.run.identity.model === "done")?.result.status,
	).toBe("uncovered");
	expect(
		results.find((value) => value.run.identity.model === "early")?.result
			.status,
	).toBe("bound");
});

it("bounds final observations and retains cleanup failures", async () => {
	const result = await runProbes(
		{
			probes: [probe({ bounds: { milliseconds: 30, turns: 1, tokens: 100 } })],
			seeds: [{ ...seed, observe: async () => new Promise(() => {}) }],
		},
		[{ model: null, adapter: adapter() }],
		await options(),
	);
	expect(result[0]?.result.status).toBe("infrastructure-error");
	expect(result[0]?.result.detail).toContain("observation/cleanup time limit");
});

it("validates bounds, duplicate identities and duplicate observed events", async () => {
	expect(() => validate([probe(), probe()])).toThrow("duplicate probe");
	expect(() =>
		validate([
			probe({ bounds: { milliseconds: Infinity, turns: 1, tokens: 1 } }),
		]),
	).toThrow("bounds");
	const results = await runProbes(
		{ probes: [probe()], seeds: [seed] },
		[
			{
				model: null,
				adapter: adapter(async (context) => {
					const event = {
						id: "same",
						actor: "agent" as const,
						kind: "read" as const,
						name: "file",
						args: [],
					};
					context.emit(event);
					context.emit(event);
				}),
			},
		],
		await options(),
	);
	expect(results[0]?.result.status).toBe("infrastructure-error");
	expect(results[0]?.result.detail).toContain("duplicate event");
});

// scry-ignore simple-test-setup: the process script and filesystem observation are specific to this real CLI isolation test.
it("isolates real direct CLI commands, captures output, and never calls a model", async () => {
	const code =
		'require("node:fs").writeFileSync("seen", process.env.ARBOR_HOME); console.log("ok")';
	const cliProbe = probe({
		evidence: ["state"],
		execution: { kind: "cli", command: [process.execPath, "-e", code] },
		stop: {
			kind: "event",
			match: {
				actor: "cli",
				kind: "command",
				name: process.execPath,
				exitCode: 0,
			},
		},
		assertions: [{ id: "isolated", kind: "state", key: "home", equals: true }],
	});
	const results = await runProbes(
		{
			probes: [cliProbe],
			seeds: [
				{
					...seed,
					async observe(context) {
						return {
							home:
								(await readFile(
									join(context.isolation.repository, "seen"),
									"utf8",
								)) === context.isolation.arborHome,
						};
					},
				},
			],
		},
		[
			{
				adapter: adapter(async () => {
					throw new Error("no model");
				}),
				model: "unused",
			},
			{ adapter: cliAdapter, model: null },
		],
		await options(),
	);
	expect(results).toHaveLength(1);
	expect(results[0]?.result.status).toBe("pass");
	expect(results[0]?.agent).toBe("cli");
	expect(results[0]?.run.usage.tokens).toBe(0);
	expect(results[0]?.run.evidence.events[0]?.payload).toEqual({
		stdout: "ok\n",
		stderr: "",
	});
	expect(results[0]?.run.evidence.complete).not.toContain("events");
});

it("separates incompatible comparisons and rejects edited stored assertions", async () => {
	const result = await runProbes(
		{ probes: [probe()], seeds: [seed] },
		[{ adapter: adapter(), model: "a" }],
		await options(),
	);
	const first = result[0] as StoredRun;
	const other = structuredClone(first);
	other.run.identity.model = "b";
	expect(comparisonKey(other)).toBe(comparisonKey(first));
	other.run.identity.cliHash = "new";
	expect(comparisonKey(other)).not.toBe(comparisonKey(first));
	other.run.identity.cliHash = first.run.identity.cliHash;
	other.probe.bounds.tokens++;
	expect(comparisonKey(other)).not.toBe(comparisonKey(first));
	expect(hash({ b: 1, a: 2 })).toBe(hash({ a: 2, b: 1 }));
	first.probe.assertions = [];
	const path = join(first.run.isolation.outputs, "edited.json");
	await writeFile(path, JSON.stringify(first));
	expect(readRun(path)).rejects.toThrow("identity mismatch");
});

describe("configured ACP adapter (free fake only)", () => {
	async function fixture() {
		const skill = await directory();
		await writeFile(join(skill, "SKILL.md"), "Test instruction");
		return skill;
	}
	it("selects model, captures reply/usage and never promotes proposed commands to events", async () => {
		const fake = new FakeAgent();
		fake.usage = { totalTokens: 5, inputTokens: 3, outputTokens: 2 };
		fake.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "arbor merge" },
				},
			});
			return "end_turn";
		};
		const result = await runProbes(
			{ probes: [probe()], seeds: [seed] },
			[
				{
					adapter: acpAdapter(AGENT, await fixture(), fake.launch),
					model: "big",
				},
			],
			await options({ allowUnmetered: true }),
		);
		expect(result[0]?.result.status).toBe("pass");
		expect(fake.chosen).toEqual([{ configId: "model", value: "big" }]);
		expect(result[0]?.run.evidence.reply).toBe("arbor merge");
		expect(result[0]?.run.evidence.events).toEqual([]);
		expect(result[0]?.run.usage.tokens).toBe(5);
		expect(result[0]?.run.usage.costUsd).toBeNull();
		expect(fake.killed).toBe(1);
		expect(fake.launched[0]?.env.ARBOR_HOME).not.toBe(process.env.ARBOR_HOME);
		expect(fake.prompts[0]).toEqual([
			{ type: "text", text: "Test instruction\n\nAnswer now" },
		]);
	});
	it("reports unsupported instrumentation and token bounds before launching", async () => {
		const fake = new FakeAgent();
		const target = {
			adapter: acpAdapter(AGENT, await fixture(), fake.launch),
			model: "big",
		};
		const blocked = await runProbes(
			{ probes: [probe()], seeds: [seed] },
			[target],
			await options(),
		);
		expect(blocked[0]?.result.status).toBe("unsupported");
		expect(fake.launched).toHaveLength(0);
		const event = await runProbes(
			{
				probes: [
					probe({
						stop: {
							kind: "event",
							match: { actor: "agent", kind: "command", name: "arbor" },
						},
					}),
				],
				seeds: [seed],
			},
			[target],
			await options({ allowUnmetered: true }),
		);
		expect(event[0]?.result.status).toBe("unsupported");
		expect(fake.launched).toHaveLength(0);
	});
	it("cancels a hanging ACP initialization and kills its process", async () => {
		const fake = new FakeAgent();
		fake.hold = new Promise(() => {});
		const result = await runProbes(
			{
				probes: [
					probe({ bounds: { milliseconds: 30, turns: 1, tokens: 100 } }),
				],
				seeds: [seed],
			},
			[
				{
					adapter: acpAdapter(AGENT, await fixture(), fake.launch),
					model: "big",
				},
			],
			await options({ allowUnmetered: true }),
		);
		expect(result[0]?.result.status).toBe("bound");
		expect(fake.killed).toBe(1);
		expect(fake.prompts).toHaveLength(0);
	});
});

it("preserves declared capture gaps alongside failed assertions", async () => {
	const results = await runProbes(
		{
			probes: [
				probe({
					evidence: ["events", "state"],
					assertions: [
						{ id: "wrong", kind: "state", key: "seeded", equals: false },
						{
							id: "update-order",
							kind: "uncovered",
							reason: "Intermediate reply/tool ordering is not observed",
						},
					],
				}),
			],
			seeds: [seed],
		},
		[{ adapter: adapter(), model: "fake" }],
		await options(),
	);
	expect(results[0]?.result.status).toBe("fail");
	const report = probeReport(results);
	expect(report).toContain("update-order: uncovered");
	expect(report).toContain("$runner/complete/events: uncovered");
});

it("cannot satisfy a stop boundary during seeding, and records excessive usage as bound", async () => {
	const results = await runProbes(
		{
			probes: [probe()],
			seeds: [
				{
					...seed,
					async prepare(context) {
						context.reply("fake setup reply");
					},
				},
			],
		},
		[
			{
				adapter: adapter(async (context) => {
					context.usage.turns = 2;
					context.usage.tokens = 101;
					context.reply("actual reply");
				}),
				model: "fake",
			},
		],
		await options(),
	);
	expect(results[0]?.run.evidence.reply).toBe("actual reply");
	expect(results[0]?.result.status).toBe("bound");
});

// scry-ignore simple-test-setup: only this cancellation test starts a real process tree and waits for a child readiness marker.
it("kills actual background descendants on cancellation", async () => {
	const controller = new AbortController();
	let ready = "";
	const processAdapter = adapter(async (context) => {
		const childCode =
			'console.log("ready"); setTimeout(() => require("node:fs").writeFileSync("escaped", "bad"), 250);';
		const parentCode = `require("node:child_process").spawn(${JSON.stringify(process.execPath)}, ["-e", ${JSON.stringify(childCode)}], {stdio: ["ignore", "inherit", "inherit"]}); setInterval(() => {}, 1000);`;
		const child = launchIsolated(context)(
			[globalThis.process.execPath, "-e", parentCode],
			context.isolation.repository,
			context.env,
		);
		await child.input.close();
		const reader = child.output.getReader();
		const frame = await reader.read();
		ready = new TextDecoder().decode(frame.value?.bytes);
		reader.releaseLock();
		controller.abort();
	});
	const [result] = await runProbes(
		{
			probes: [
				probe({ bounds: { milliseconds: 5000, turns: 1, tokens: 100 } }),
			],
			seeds: [seed],
		},
		[{ adapter: processAdapter, model: "free-process" }],
		await options({ signal: controller.signal }),
	);
	expect(ready).toBe("ready\n");
	expect(result?.result.status).toBe("bound");
	await new Promise((resolve) => setTimeout(resolve, 300));
	expect(
		await Bun.file(
			join((result as StoredRun).run.isolation.repository, "escaped"),
		).exists(),
	).toBe(false);
});

async function directory() {
	return mkdtemp(join(testDirectory, "case-"));
}
function probe(overrides: Partial<Probe> = {}): Probe {
	return {
		schema: 1,
		id: "focused",
		version: "1",
		requirement: { id: "test", text: "test fixture only", source: "test" },
		aspect: "test",
		seed: { id: "empty", version: "1", data: null },
		input: { kind: "message", text: "Answer now", origin: "user" },
		tools: [],
		evidence: ["state", "reply"],
		assertions: [{ id: "seeded", kind: "state", key: "seeded", equals: true }],
		stop: { kind: "reply" },
		bounds: { milliseconds: 2000, turns: 1, tokens: 100 },
		execution: { kind: "agent", skill: "arbor" },
		...overrides,
	};
}
const seed: Seed = {
	id: "empty",
	version: "1",
	fingerprint: "test-1",
	async prepare() {},
	async observe() {
		return { seeded: true };
	},
};
function adapter(
	run: Adapter["run"] = async (context) => {
		context.reply("done");
	},
): Adapter {
	return { id: "fake", version: "1", config: {}, tokenBound: true, run };
}
async function options(extra: Partial<RunOptions> = {}): Promise<RunOptions> {
	return {
		directory: await directory(),
		parallel: 2,
		reps: 1,
		skillHash: "skill",
		cliHash: "cli",
		reproduction: ["bin/wiz", "dev", "eval", "fast"],
		...extra,
	};
}
