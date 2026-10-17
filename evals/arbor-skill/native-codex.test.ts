import { afterEach, beforeEach, expect, it } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeUpdate, nativeAdapter } from "./native-adapter";
import { nativeCodex } from "./native-codex";
import type { Probe } from "./probe";
import { runProbes } from "./runner";

let directory: string;
let skill: string;
beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "native-codex-")));
	skill = join(directory, "skill");
	await mkdir(skill);
	await writeFile(
		join(skill, "SKILL.md"),
		"---\nname: arbor\ndescription: fixture\n---\nNative fixture instructions",
	);
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
it("keeps native discovery, cumulative usage, final reply and tool evidence distinct", async () => {
	const result = await run();
	expect(result.result.status).toBe("uncovered");
	expect(result.run.usage.tokens).toBe(12);
	const replyIndex = result.updates.findIndex(
		(update) => update.kind === "reply",
	);
	expect(result.updates[replyIndex - 1]).toEqual({
		kind: "usage",
		tokens: 12,
		costUsd: null,
		final: false,
	});
	expect(result.run.usage.costUsd).toBeNull();
	expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
	expect(result.run.evidence.detail ?? "").not.toContain("cleanup:");
	expect(result.run.evidence.events).toEqual([]);
	expect(result.result.verdicts).toContainEqual(
		expect.objectContaining({ id: "reply", status: "pass" }),
	);
	const wire = await messages();
	expect(
		wire.find((item) => item.method === "turn/start").params.input,
	).toEqual([{ type: "text", text: "answer", text_elements: [] }]);
	const thread = wire.find((item) => item.method === "thread/start").params;
	expect(thread.baseInstructions).toBeUndefined();
	expect(thread.config["features.multi_agent"]).toBe(false);
	expect(thread.config['mcp_servers."fixture".enabled']).toBe(false);
	expect(thread.allowProviderModelFallback).toBe(false);
	await stopped();
});
it("uses an explicit native skill item without injecting its text", async () => {
	await run("success", {}, "explicit");
	expect(
		(await messages()).find((item) => item.method === "turn/start").params
			.input[1],
	).toEqual({ type: "skill", name: "arbor", path: join(skill, "SKILL.md") });
});
it("refuses auth before prompting and awaits process cleanup", async () => {
	const result = await run("auth");
	expect(result.result.status).toBe("unsupported");
	expect((await messages()).some((item) => item.method === "turn/start")).toBe(
		false,
	);
	await stopped();
});
it("refuses version before prompting and awaits process cleanup", async () => {
	const result = await run("version");
	expect(result.result.status).toBe("unsupported");
	expect((await messages()).some((item) => item.method === "turn/start")).toBe(
		false,
	);
	await stopped();
});
it("refuses skill before prompting and awaits process cleanup", async () => {
	const result = await run("skill");
	expect(result.result.status).toBe("unsupported");
	expect((await messages()).some((item) => item.method === "turn/start")).toBe(
		false,
	);
	await stopped();
});
it("refuses model before prompting and awaits process cleanup", async () => {
	const result = await run("model");
	expect(result.result.status).toBe("unsupported");
	expect((await messages()).some((item) => item.method === "turn/start")).toBe(
		false,
	);
	await stopped();
});
it("refuses permission before prompting and awaits process cleanup", async () => {
	const result = await run("permission");
	expect(result.result.status).toBe("unsupported");
	expect((await messages()).some((item) => item.method === "turn/start")).toBe(
		false,
	);
	await stopped();
});
it("refuses capability before prompting and awaits process cleanup", async () => {
	const result = await run("capability");
	expect(result.result.status).toBe("unsupported");
	expect((await messages()).some((item) => item.method === "turn/start")).toBe(
		false,
	);
	await stopped();
});
it("retains exit failure without a fabricated reply or complete usage", async () => {
	const result = await run("exit");
	expect(result.result.status).toBe("infrastructure-error");
	expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
	expect(result.run.evidence.detail ?? "").not.toContain("cleanup:");
	await stopped();
});
it("retains malformed failure without a fabricated reply or complete usage", async () => {
	const result = await run("malformed");
	expect(result.result.status).toBe("infrastructure-error");
	expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
	expect(result.run.evidence.detail ?? "").not.toContain("cleanup:");
	await stopped();
});
it("retains failed failure without a fabricated reply or complete usage", async () => {
	const result = await run("failed");
	expect(result.result.status).toBe("infrastructure-error");
	expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
	expect(result.run.evidence.detail ?? "").not.toContain("cleanup:");
	await stopped();
});
it("retains broken-stream failure without a fabricated reply or complete usage", async () => {
	const result = await run("broken-stream");
	expect(result.result.status).toBe("infrastructure-error");
	expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
	expect(result.run.evidence.detail ?? "").not.toContain("cleanup:");
	await stopped();
});
it("retains regression failure without a fabricated reply or complete usage", async () => {
	const result = await run("regression");
	expect(result.result.status).toBe("infrastructure-error");
	expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
	expect(result.run.evidence.detail ?? "").not.toContain("cleanup:");
	await stopped();
});
it("retains missing-phase failure without a fabricated reply or complete usage", async () => {
	const result = await run("missing-phase");
	expect(result.result.status).toBe("infrastructure-error");
	expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
	expect(result.run.evidence.detail ?? "").not.toContain("cleanup:");
	await stopped();
});
it("leaves missing usage unknown", async () => {
	expect((await run("missing-usage")).run.usage.tokens).toBeNull();
});
it("interrupts a monitored threshold, retains overshoot and awaits cleanup", async () => {
	const result = await run("cancel");
	expect(result.result.status).toBe("bound");
	expect(result.run.usage.tokens).toBe(117);
	expect(
		(await messages()).filter((item) => item.method === "turn/interrupt"),
	).toHaveLength(1);
	await stopped();
});
it("kills a hung startup on timeout", async () => {
	const result = await run("startup-hang", {
		bounds: { ...probe.bounds, milliseconds: 150 },
	});
	expect(result.result.status).toBe("bound");
	await stopped();
});
it("awaits owned descendants on cancellation", async () => {
	const result = await run("child", {
		bounds: { ...probe.bounds, milliseconds: 200 },
	});
	expect(result.result.status).toBe("bound");
	await stopped();
	await stopped("child");
});
it("rejects narrower tool allowlists without launching", async () => {
	const result = await run("success", { tools: ["arbor", "read", "write"] });
	expect(result.result.status).toBe("unsupported");
	await expect(readFile(join(directory, "wire"))).rejects.toThrow();
});
it("declares only monitored token controls and refuses an unspecified model", async () => {
	const driver = nativeCodex({ allowance: { tokens: 100, microUsd: 1000 } });
	expect(driver.limits).toEqual({
		tokens: "monitored",
		costUsd: "unavailable",
	});
	expect(driver.quote(probe, null)).toBeNull();
	expect(driver.quote(probe, "model")).toEqual({ tokens: 100, microUsd: 1000 });
});

it("declines native approval requests", async () => {
	await run("approval");
	expect((await messages()).find((item) => item.id === "approval")).toEqual({
		id: "approval",
		result: { decision: "decline" },
	});
});
it("refuses tool-free probes before launching", async () => {
	expect((await run("success", { tools: [] })).result.status).toBe(
		"unsupported",
	);
	await expect(readFile(join(directory, "wire"))).rejects.toThrow();
});
it("refuses event stops before launching", async () => {
	expect(
		(
			await run("success", {
				stop: {
					kind: "event",
					match: { kind: "command", actor: "agent", name: "arbor" },
				},
			})
		).result.status,
	).toBe("unsupported");
	await expect(readFile(join(directory, "wire"))).rejects.toThrow();
});
it("cleans up an unavailable executable", async () => {
	expect((await run("spawn-error")).result.status).toBe("unsupported");
});
it("honors caller cancellation while a native turn is active", async () => {
	const controller = new AbortController();
	const running = run("hang", {}, "discovery", controller.signal);
	const timer = setTimeout(() => controller.abort(), 100);
	try {
		expect((await running).result.status).toBe("bound");
		await stopped();
	} finally {
		clearTimeout(timer);
	}
});

const probe: Probe = {
	schema: 1,
	id: "codex-wire",
	version: "1",
	requirement: { id: "test", text: "test", source: "test" },
	aspect: "test",
	seed: { id: "empty", version: "1", data: null },
	input: { kind: "message", text: "answer", origin: "user" },
	tools: ["shell", "read", "write"],
	evidence: ["reply", "events"],
	assertions: [
		{
			id: "reply",
			kind: "reply",
			type: "report",
			field: ["report", "task"],
			equals: "sample",
		},
	],
	stop: { kind: "reply" },
	bounds: { milliseconds: 2500, turns: 1, tokens: 100 },
	execution: { kind: "agent", skill: "arbor" },
};
async function run(
	scenario = "success",
	changes: Partial<Probe> = {},
	mode: "discovery" | "explicit" = "discovery",
	signal?: AbortSignal,
) {
	const driver = nativeCodex({
		allowance: { tokens: 100, microUsd: 1000 },
		argv: [
			scenario === "spawn-error"
				? "/nonexistent-codex-native-fixture"
				: process.execPath,
			join(import.meta.dir, "fixtures/native-codex/server.ts"),
			scenario,
			join(directory, "wire"),
		],
	});
	const updates: NativeUpdate[] = [];
	const create = driver.create;
	driver.create = (request) => {
		const session = create(request);
		return {
			run: (emit) =>
				session.run((update) => {
					updates.push(update);
					emit(update);
				}),
			cancel: () => session.cancel(),
			dispose: () => session.dispose(),
		};
	};
	const [result] = await runProbes(
		{
			probes: [{ ...probe, ...changes }],
			seeds: [
				{
					id: "empty",
					version: "1",
					fingerprint: "1",
					prepare: async () => {},
					observe: async () => ({}),
				},
			],
		},
		[
			{
				adapter: nativeAdapter(driver, { source: skill, mode }),
				model: "fixture-model",
			},
		],
		{
			directory: join(directory, "results"),
			parallel: 1,
			reps: 1,
			skillHash: "fixture",
			cliHash: "fixture",
			budget: { tokens: 100, microUsd: 1000 },
			reproduction: [],
			signal,
		},
	);
	if (!result) {
		throw new Error("Missing fixture result");
	}
	return { ...result, updates };
}
async function messages() {
	return (await readFile(join(directory, "wire"), "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}
async function stopped(suffix = "pid") {
	const pid = Number(await readFile(join(directory, `wire.${suffix}`), "utf8"));
	expect(() => process.kill(pid, 0)).toThrow();
}
