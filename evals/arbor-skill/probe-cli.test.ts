import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import type { Probe } from "./probe";
import { cliAdapter } from "./probe-adapters";
import { fastCli, storedRuns } from "./probe-cli";
import { command, normalizeCommand, seedRepository } from "./probe-sandbox";
import { runProbes } from "./runner";

let testDirectory: string;
beforeEach(async () => {
	testDirectory = await mkdtemp(join(tmpdir(), "probe-cli-test-"));
});
afterEach(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

// scry-ignore simple-test-setup: this test alone loads a module and exercises persisted CLI selections; the other tests use the runner directly.
it("selects/lists/reports/reruns only compatible failed cases through the CLI, using no models", async () => {
	const dir = await directory();
	const module = join(dir, "cases.ts");
	const skill = join(dir, "skill");
	const output = join(dir, "runs");
	await mkdir(skill);
	await writeFile(join(skill, "SKILL.md"), "Test skill");
	await writeFile(
		module,
		`export default {probes: ${JSON.stringify([probe("pass", true), probe("fail", false)])}, seeds: [{id: "empty", version: "1", fingerprint: "1", async prepare() {}, async observe() {return {seen: true};}}]};`,
	);
	const log = new MemoryLogger();
	const invoke = (args: string[]) => fastCli(args, log);
	const exitCode = process.exitCode;
	try {
		const args = ["--module", module, "--skill", skill, "--directory", output];
		await invoke(["list", ...args, "--requirement", "test-pass"]);
		expect(log.entries.map((entry) => entry.message).join("\n")).toContain(
			"pass\tframework-test\ttest-pass",
		);
		expect(log.entries.map((entry) => entry.message).join("\n")).not.toContain(
			"test-fail",
		);
		await expect(
			invoke(["fast", ...args, "--probe", "missing"]),
		).rejects.toThrow("unknown probe");
		await invoke(["fast", ...args, "--parallel", "2"]);
		expect(
			(await storedRuns(output)).map((run) => run.result.status).sort(),
		).toEqual(["fail", "pass"]);
		await invoke(["fast", ...args, "--failed"]);
		expect(
			(await storedRuns(output)).map((run) => run.result.status).sort(),
		).toEqual(["fail", "fail", "pass"]);
		const before = await readdir(output);
		await invoke(["report", "--directory", output, "--failed"]);
		expect(await readdir(output)).toEqual(before);
		expect(log.entries.map((entry) => entry.message).join("\n")).toContain(
			"expected false; actual true",
		);
		await writeFile(join(skill, "SKILL.md"), "Changed skill");
		await expect(invoke(["fast", ...args, "--failed"])).rejects.toThrow(
			"No compatible",
		);
	} finally {
		process.exitCode = exitCode ?? 0;
	}
});

it("seeds a real minimal repository and permits read-only observations after the stop", async () => {
	const selected = probe("local-cli", true);
	selected.execution = { kind: "cli", command: ["arbor", "--help"] };
	selected.stop = {
		kind: "event",
		match: { actor: "cli", kind: "command", name: "arbor", exitCode: 0 },
	};
	const results = await runProbes(
		{
			probes: [selected],
			seeds: [
				{
					id: "empty",
					version: "1",
					fingerprint: "test",
					prepare: seedRepository,
					async observe(context) {
						const status = await command(context, [
							"git",
							"status",
							"--porcelain",
						]);
						return { seen: status.exitCode === 0 && status.stdout === "" };
					},
				},
			],
		},
		[{ adapter: cliAdapter, model: null }],
		{
			directory: await directory(),
			parallel: 1,
			reps: 1,
			skillHash: "test",
			cliHash: "test",
			reproduction: ["test"],
		},
	);
	expect(results[0]?.result.status).toBe("pass");
	expect(
		results[0]?.run.evidence.events.filter((event) => event.actor === "cli"),
	).toHaveLength(1);
	expect(
		results[0]?.run.evidence.events.filter(
			(event) => event.actor === "fixture",
		),
	).toHaveLength(5);
	expect(results[0]?.run.evidence.complete).not.toContain("events");
});

it("normalizes real argv forms without parsing shell text", () => {
	expect(
		normalizeCommand([
			"bunx",
			"@webappwiz/arbor",
			"todo",
			"add",
			"quoted title",
		]),
	).toEqual({ name: "arbor", args: ["todo", "add", "quoted title"] });
	expect(normalizeCommand(["/sandbox/bin/arbor", "merge"])).toEqual({
		name: "arbor",
		args: ["merge"],
	});
	expect(normalizeCommand(["sh", "-c", "echo arbor merge"])).toEqual({
		name: "sh",
		args: ["-c", "echo arbor merge"],
	});
});

async function directory() {
	return mkdtemp(join(testDirectory, "case-"));
}
function probe(id: string, expected: boolean): Probe {
	return {
		schema: 1,
		id,
		version: "1",
		aspect: "framework-test",
		requirement: { id: `test-${id}`, text: "Free runner test", source: "test" },
		seed: { id: "empty", version: "1", data: null },
		input: { kind: "message", text: "", origin: "user" },
		tools: [],
		evidence: ["state"],
		assertions: [
			{ id: "observed", kind: "state", key: "seen", equals: expected },
		],
		stop: {
			kind: "event",
			match: {
				actor: "cli",
				kind: "command",
				name: process.execPath,
				exitCode: 0,
			},
		},
		bounds: { milliseconds: 5000, turns: 1, tokens: 1 },
		execution: {
			kind: "cli",
			command: [process.execPath, "-e", 'console.log("free")'],
		},
	};
}
