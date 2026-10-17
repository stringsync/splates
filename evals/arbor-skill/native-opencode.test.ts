import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeAdapter } from "./native-adapter";
import { opencodeDriver } from "./native-opencode";
import type { Probe } from "./probe";
import { launchIsolated } from "./probe-adapters";
import { runProbes } from "./runner";

it("uses native HTTP/SSE, skill discovery, exact model, permissions and cumulative deduplicated usage", async () => {
	const { result, home, exited } = await run();
	expect(exited).toBe(true);
	expect(result.run.usage.tokens).toBe(40);
	expect(result.run.usage.costUsd).toBe(0.002);
	expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
	expect(result.run.evidence.events).toEqual([]);
	expect(result.result.status).toBe("uncovered");
	const sent = JSON.parse(await readFile(join(home, "request.json"), "utf8"));
	expect(sent.body.model).toEqual({ providerID: "provider", modelID: "model" });
	expect(sent.body.parts).toEqual([{ type: "text", text: "answer" }]);
	expect(sent.config.permission).toEqual({
		"*": "deny",
		skill: "allow",
		bash: "allow",
		read: "allow",
		glob: "allow",
		grep: "allow",
		edit: "allow",
	});
	expect(
		await readFile(
			join(home, ".config/opencode/skills/arbor/SKILL.md"),
			"utf8",
		),
	).toContain("Native skill bytes");
	expect(await readFile(join(home, "aborted"), "utf8")).toBe("owned");
});
it("explicit use names the native skill without injecting its body", async () => {
	const { home } = await run("success", "explicit");
	const sent = JSON.parse(await readFile(join(home, "request.json"), "utf8"));
	expect(sent.body.parts[0].text).toBe("Use the arbor skill.\n\nanswer");
});
it("reports unsupported auth and awaits cleanup", async () => {
	const { result, exited } = await run("auth");
	expect(result.run.evidence.termination).toBe("unsupported");
	expect(exited).toBe(true);
});
it("reports unsupported skill and awaits cleanup", async () => {
	const { result, exited } = await run("skill");
	expect(result.run.evidence.termination).toBe("unsupported");
	expect(exited).toBe(true);
});
it("reports unsupported permissions and awaits cleanup", async () => {
	const { result, exited } = await run("permissions");
	expect(result.run.evidence.termination).toBe("unsupported");
	expect(exited).toBe(true);
});
it("reports unsupported provider-error and awaits cleanup", async () => {
	const { result, exited } = await run("provider-error");
	expect(result.run.evidence.termination).toBe("unsupported");
	expect(exited).toBe(true);
});
it("fails startup and awaits cleanup", async () => {
	const { result, exited } = await run("startup");
	expect(result.result.status).toBe("infrastructure-error");
	expect(exited).toBe(true);
});
it("fails http-error and awaits cleanup", async () => {
	const { result, exited } = await run("http-error");
	expect(result.result.status).toBe("infrastructure-error");
	expect(exited).toBe(true);
});
it("fails stream-end and awaits cleanup", async () => {
	const { result, exited } = await run("stream-end");
	expect(result.result.status).toBe("infrastructure-error");
	expect(exited).toBe(true);
});
it("cancels at reported monitored overshoot, aborting only its session and awaiting server exit", async () => {
	const { result, home, exited } = await run("cancel");
	expect(result.result.status).toBe("bound");
	expect(result.run.usage.tokens).toBe(230);
	expect(result.adapter.runtime.overshoot).toEqual({
		tokens: 130,
		microUsd: 0,
	});
	expect(exited).toBe(true);
	expect(await readFile(join(home, "aborted"), "utf8")).toBe("owned");
});
it("does not fabricate missing usage", async () => {
	const { result } = await run("unknown");
	expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
	expect(result.result.status).toBe("uncovered");
	// Unknown cumulative totals remain unknown, even after earlier known messages.
	expect(result.run.usage.tokens).toBeNull();
});
it("refuses unknown tool permissions before server launch", async () => {
	const { result, launched } = await run("success", "discovery", ["task"]);
	expect(result.run.evidence.termination).toBe("unsupported");
	expect(launched).toBe(0);
});
it("quotes reservations without launching and labels monitored controls", () => {
	const driver = opencodeDriver({
		allowance: { tokens: 100, microUsd: 10000 },
	});
	expect(driver.quote(probe, "provider/model")).toEqual({
		tokens: 100,
		microUsd: 10000,
	});
	expect(driver.quote(probe, "model")).toBeNull();
	expect(driver.limits).toEqual({ tokens: "monitored", costUsd: "monitored" });
});

it("reports an absent executable as actionable unsupported without fallback", async () => {
	const { result } = await run("missing");
	expect(result.run.evidence.termination).toBe("unsupported");
	expect(result.run.evidence.detail).toContain("executable not found");
});
it("includes owned child usage once and ignores unrelated sessions", async () => {
	const { result } = await run("children");
	expect(result.run.usage.tokens).toBe(60);
	expect(result.run.usage.costUsd).toBe(0.003);
	expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
});
it("reports streamed provider auth errors as unsupported", async () => {
	const { result, exited } = await run("stream-auth");
	expect(result.run.evidence.termination).toBe("unsupported");
	expect(result.run.evidence.detail).toContain("authentication failed");
	expect(exited).toBe(true);
});
let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "native-opencode-test-"));
	await mkdir(join(directory, "skill"));
	await writeFile(
		join(directory, "skill", "SKILL.md"),
		"---\nname: arbor\ndescription: fixture skill\n---\nNative skill bytes.\n",
	);
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
const probe: Probe = {
	schema: 1,
	id: "native-opencode",
	version: "1",
	requirement: { id: "native", text: "native", source: "fixture" },
	aspect: "test",
	seed: { id: "empty", version: "1", data: null },
	input: { kind: "message", text: "answer", origin: "user" },
	tools: ["exec", "read", "write"],
	evidence: ["reply", "state", "events"],
	assertions: [{ id: "state", kind: "state", key: "ok", equals: true }],
	stop: { kind: "reply" },
	bounds: { milliseconds: 5000, turns: 1, tokens: 100 },
	execution: { kind: "agent", skill: "arbor" },
};
async function run(
	scenario = "success",
	mode: "discovery" | "explicit" = "discovery",
	tools = probe.tools,
	model = "provider/model",
) {
	let home = "";
	let exited = false;
	let launched = 0;
	const driver = opencodeDriver({
		allowance: { tokens: 100, microUsd: 10000 },
	});
	const create = driver.create;
	driver.create = (request) => {
		const custom = opencodeDriver({
			allowance: { tokens: 100, microUsd: 10000 },
			launch: (argv, cwd, env) => {
				launched++;
				expect(argv.slice(1)).toEqual([
					"serve",
					"--hostname=127.0.0.1",
					"--port=0",
				]);
				home = env.HOME ?? "";
				const child = launchIsolated({ ...request.context, cleanup: () => {} })(
					[
						scenario === "missing"
							? "/nonexistent/opencode-fixture"
							: process.execPath,
						join(import.meta.dir, "fixtures/opencode/server.ts"),
					],
					cwd,
					{ ...env, OPENCODE_FIXTURE: scenario },
				);
				void child.exited.then(() => {
					exited = true;
				});
				return child;
			},
		});
		return custom.create(request);
	};
	expect(create).toBeFunction();
	const [result] = await runProbes(
		{
			probes: [{ ...probe, tools }],
			seeds: [
				{
					id: "empty",
					version: "1",
					fingerprint: "1",
					async prepare() {},
					async observe() {
						return { ok: true };
					},
				},
			],
		},
		[
			{
				adapter: nativeAdapter(driver, {
					source: join(directory, "skill"),
					mode,
				}),
				model,
			},
		],
		{
			directory: join(directory, "results"),
			parallel: 1,
			reps: 1,
			skillHash: "test",
			cliHash: "test",
			reproduction: [],
			budget: { tokens: 100, microUsd: 10000 },
		},
	);
	if (!result) {
		throw new Error("Missing fixture result");
	}
	return { result, home, exited, launched };
}
