import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MemoryLogger } from "webappwiz/log";
import type { Probe } from "./probe";
import type { Metering } from "./probe-affordability";
import {
	admit,
	assertLegacyReport,
	budget,
	DEFAULT_BUDGET,
} from "./probe-affordability";
import { skillChange, smokeProbes } from "./probe-change";
import { fastCli, loadModules } from "./probe-cli";
import { type Adapter, type ProbeModule, runProbes } from "./runner";

const exec = promisify(execFile);
let directory: string;
let skill: string;
let module: ProbeModule;

it("skips unchanged instructions before roster lookup, authentication, confirmation or model execution", async () => {
	await writeFile(join(directory, "app.ts"), "unrelated");
	const log = new MemoryLogger();
	await fastCli(
		[
			"fast",
			"--baseline",
			"HEAD",
			"--skill",
			skill,
			"--target",
			"nonexistent:model",
		],
		log,
	);
	expect(log.entries.map((entry) => entry.message).join("\n")).toContain(
		"Skipped model execution",
	);
	expect((await skillChange(skill, "HEAD")).files).toEqual([]);
});

it("plans a targeted reference smoke without consulting targets or metering services", async () => {
	await writeFile(
		join(skill, "references/todos.md"),
		"Changed todos instructions",
	);
	const log = new MemoryLogger();
	await fastCli(
		[
			"plan",
			"--baseline",
			"HEAD",
			"--skill",
			skill,
			"--target",
			"nonexistent:model",
		],
		log,
	);
	const output = log.entries.map((entry) => entry.message).join("\n");
	expect(output).toContain(
		"Selected: orchestration/dependency; reps 1; parallel 1; aggregate ceilings 4000 tokens / USD 0.100000",
	);
	expect(output).toContain("Plan only");
});

it("compares dirty and committed edits, additions, renames and deletions against immutable baseline bytes", async () => {
	const initial = await skillChange(skill, "HEAD");
	await writeFile(join(skill, "SKILL.md"), "# Arbor\nChanged\n");
	await rename(
		join(skill, "references/todos.md"),
		join(skill, "references/renamed.md"),
	);
	const dirty = await skillChange(skill, initial.baseline);
	expect(dirty.files).toEqual([
		"SKILL.md",
		"references/renamed.md",
		"references/todos.md",
	]);
	await exec("git", ["add", "."], { cwd: directory });
	await exec(
		"git",
		[
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"-qm",
			"instructions",
		],
		{ cwd: directory },
	);
	expect(await skillChange(skill, initial.baseline)).toEqual(dirty);
	expect((await skillChange(skill, "HEAD")).files).toEqual([]);
});

it("fails closed on absent baseline, invalid revisions, missing root instructions and symlinked references", async () => {
	await expect(skillChange(skill)).rejects.toThrow("--baseline");
	await expect(skillChange(skill, "missing-revision")).rejects.toThrow();
	await expect(skillChange(directory, "HEAD")).rejects.toThrow("inside");
	await symlink("todos.md", join(skill, "references/link.md"));
	await expect(skillChange(skill, "HEAD")).rejects.toThrow("Symlinked");
	await rm(join(skill, "references/link.md"));
	await rm(join(skill, "SKILL.md"));
	await expect(skillChange(skill, "HEAD")).rejects.toThrow(
		"no readable SKILL.md",
	);
});

it("selects at most two mapped default smoke cases and refuses unmapped expansion", () => {
	expect(
		smokeProbes(module.probes, ["references/checkpoint.md"]).map(
			(probe) => probe.id,
		),
	).toEqual(["continuity/checkpoint"]);
	expect(
		smokeProbes(module.probes, [
			"SKILL.md",
			"references/todos.md",
			"references/parts.md",
		]).map((probe) => probe.id),
	).toEqual(["discovery/implicit", "orchestration/dependency"]);
	expect(() => smokeProbes(module.probes, ["references/new.md"])).toThrow(
		"explicit relevant --probe",
	);
});

it("rejects unmetered opt-in and legacy model execution, while leaving reports available", async () => {
	await expect(
		fastCli(
			["fast", "--allow-unmetered", "--skill", skill],
			new MemoryLogger(),
		),
	).rejects.toThrow("forbidden");
	expect(() => assertLegacyReport(["run"])).toThrow("disabled");
	expect(() => assertLegacyReport([])).toThrow("disabled");
	expect(() => assertLegacyReport(["report"])).not.toThrow();
});

it("uses exact integer dollar ceilings and rejects unsafe or excessive budgets", () => {
	expect(budget()).toEqual({ tokens: 4000, microUsd: 100000 });
	expect(budget("1000", "0.000001")).toEqual({ tokens: 1000, microUsd: 1 });
	expect(() => budget("10001", "0.1")).toThrow("Hard invocation ceiling");
	expect(() => budget("1000", "0.250001")).toThrow("Hard invocation ceiling");
	expect(() => budget("1000", "NaN")).toThrow();
	expect(() => budget("0", "0.1")).toThrow();
	expect(() => budget("1000", "0.0000001")).toThrow();
});

// scry-ignore simple-test-setup: this test owns its no-launch counter and over-budget targets.
it("reserves every repetition/model before setup and never launches a partial over-budget batch", async () => {
	const counter = { launched: 0 };
	const adapter = metered(counter);
	const probe = module.probes.find(
		(probe) => probe.id === "continuity/checkpoint",
	) as Probe;
	const target = { adapter, model: "fake" };
	expect(
		admit(
			[
				{ probe, target },
				{ probe, target },
			],
			DEFAULT_BUDGET,
		),
	).toEqual([
		{ tokens: 2000, microUsd: 50000 },
		{ tokens: 2000, microUsd: 50000 },
	]);
	await expect(
		runProbes({ probes: [probe], seeds: module.seeds }, [target], {
			directory: join(directory, "runs"),
			parallel: 3,
			reps: 3,
			skillHash: "test",
			cliHash: "test",
			reproduction: ["test"],
			budget: { ...DEFAULT_BUDGET },
		}),
	).rejects.toThrow("Aggregate");
	expect(counter.launched).toBe(0);
	expect(() =>
		admit(
			[
				{
					probe,
					target: {
						adapter: { ...adapter, metering: undefined },
						model: "fake",
					},
				},
			],
			DEFAULT_BUDGET,
		),
	).toThrow("Unsupported metering");
	expect(() =>
		admit(
			[
				{
					probe,
					target: {
						adapter: {
							...adapter,
							metering: { ...adapter.metering, quote: () => null },
						},
						model: "unknown",
					},
				},
			],
			DEFAULT_BUDGET,
		),
	).toThrow("Unknown metering");
});

// scry-ignore simple-test-setup: only this test collects reservations from a bounded stand-in.
it("routes admitted concurrent cases only through the bounded contract, retaining full reservations on errors and unknown usage", async () => {
	const reservations: unknown[] = [];
	const adapter = metered();
	adapter.metering.run = async (context, _model, allowance) => {
		reservations.push(allowance);
		context.trace({ admitted: allowance });
		context.reply("done");
	};
	const broken = metered();
	broken.metering.run = async (_context, _model, allowance) => {
		reservations.push(allowance);
		throw new Error("provider failure after possible charge");
	};
	const probe = module.probes.find(
		(probe) => probe.id === "continuity/checkpoint",
	) as Probe;
	const runs = await runProbes(
		{
			probes: [probe],
			seeds: [
				{
					id: probe.seed.id,
					version: probe.seed.version,
					fingerprint: "synthetic",
					async prepare() {},
					async observe() {
						return {};
					},
				},
			],
		},
		[
			{ adapter, model: "unknown-usage" },
			{ adapter: broken, model: "broken" },
		],
		{
			directory: join(directory, "runs"),
			parallel: 2,
			reps: 1,
			skillHash: "test",
			cliHash: "test",
			reproduction: ["test"],
			budget: { ...DEFAULT_BUDGET },
		},
	);
	expect(reservations).toEqual([
		{ tokens: 2000, microUsd: 50000 },
		{ tokens: 2000, microUsd: 50000 },
	]);
	expect(new Set(runs.map((run) => run.run.usage.costUsd))).toEqual(
		new Set([null]),
	);
	expect(runs.map((run) => run.adapter.runtime.reserved)).toEqual([
		{ tokens: 2000, microUsd: 50000 },
		{ tokens: 2000, microUsd: 50000 },
	]);
	expect(runs.map((run) => run.result.status)).toContain(
		"infrastructure-error",
	);
});

// scry-ignore simple-test-setup: this fixture deliberately violates only the bounded provider contract to verify diagnostics, not real billing.
it("never reports success when a bounded provider reports a charge above its reservation", async () => {
	const adapter = metered();
	adapter.metering.run = async (context) => {
		context.usage.costUsd = 0.06;
		context.reply("done");
	};
	const probe = module.probes.find(
		(probe) => probe.id === "continuity/checkpoint",
	) as Probe;
	const runs = await runProbes(
		{
			probes: [probe],
			seeds: [
				{
					id: probe.seed.id,
					version: probe.seed.version,
					fingerprint: "synthetic",
					async prepare() {},
					async observe() {
						return {};
					},
				},
			],
		},
		[{ adapter, model: "bad-provider" }],
		{
			directory: join(directory, "runs"),
			parallel: 1,
			reps: 1,
			skillHash: "test",
			cliHash: "test",
			reproduction: ["test"],
			budget: { ...DEFAULT_BUDGET },
		},
	);
	expect(runs.map((run) => run.result.status)).toEqual([
		"infrastructure-error",
	]);
	expect(runs[0]?.result.detail).toContain(
		"violated its reserved metering contract",
	);
});

function metered(counter = { launched: 0 }): Adapter & { metering: Metering } {
	return {
		id: "free-stand-in",
		version: "1",
		config: {},
		tokenBound: true,
		async run() {
			throw new Error("Unbounded execution must never be called");
		},
		metering: {
			quote: () => ({ tokens: 2000, microUsd: 50000 }),
			async run(context) {
				counter.launched++;
				context.reply("done");
			},
		},
	};
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "affordability-"));
	skill = join(directory, "skills/arbor");
	await mkdir(join(skill, "references"), { recursive: true });
	await writeFile(join(skill, "SKILL.md"), "# Arbor\nOriginal instructions\n");
	await writeFile(
		join(skill, "references/todos.md"),
		"# Todos\nOriginal reference\n",
	);
	await exec("git", ["init", "-q"], { cwd: directory });
	await exec("git", ["add", "."], { cwd: directory });
	await exec(
		"git",
		[
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"-qm",
			"baseline",
		],
		{ cwd: directory },
	);
	module = await loadModules([]);
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
