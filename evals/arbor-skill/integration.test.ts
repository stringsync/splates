import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT, FakeAgent } from "@webappwiz/arbor/testing/agent";
import { MemoryLogger } from "webappwiz/log";
import { acpAdapter } from "./probe-adapters";
import { fastCli, loadModules, storedRuns } from "./probe-cli";
import { runProbes } from "./runner";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "aspect-integration-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

// scry-ignore simple-test-setup: only this inventory test reads the coverage document and registry; the execution test enters through the CLI.
it("reconciles every discovered case with the versioned coverage inventory and seed", async () => {
	const module = await loadModules([]);
	const coverage = await readFile(join(import.meta.dir, "COVERAGE.md"), "utf8");
	const rows = coverage
		.split("\n")
		.filter(
			(line) =>
				(line.startsWith("| `") && line.endsWith(" | agent |")) ||
				(line.startsWith("| `") && line.endsWith(" | cli |")),
		);
	expect(rows.sort()).toEqual(
		module.probes
			.map(
				(probe) =>
					`| \`${probe.id}\` | ${probe.version} | ${probe.requirement.id} | ${probe.execution.kind} |`,
			)
			.sort(),
	);
	expect(new Set(module.probes.map((probe) => probe.aspect)).size).toBe(6);
	expect(
		module.probes.filter(
			(probe) =>
				module.seeds.filter(
					(seed) =>
						seed.id === probe.seed.id && seed.version === probe.seed.version,
				).length !== 1,
		),
	).toEqual([]);
	expect(
		module.probes.filter(
			(probe) => probe.execution.kind === "agent" && probe.tools.length === 0,
		),
	).toEqual([]);
	const log = new MemoryLogger();
	await fastCli(
		[
			"list",
			"--aspect",
			"continuity",
			"--requirement",
			"continuity-checkpoint",
			"--probe",
			"continuity/resume",
		],
		log,
	);
	expect(log.entries.map((entry) => entry.message)).toEqual([
		"continuity/resume\tcontinuity\tcontinuity-checkpoint\tagent",
	]);
	await expect(fastCli(["list", "--kind", "typo"], log)).rejects.toThrow(
		"--kind",
	);
});

it("executes the discovered CLI suite without models and retains its deliberate capture gap", async () => {
	const exitCode = process.exitCode;
	try {
		const log = new MemoryLogger();
		await fastCli(
			["fast", "--kind", "cli", "--directory", directory, "--parallel", "2"],
			log,
		);
		const runs = await storedRuns(directory);
		expect(runs).toHaveLength(11);
		expect(new Set(runs.map((run) => run.agent))).toEqual(new Set(["cli"]));
		expect(new Set(runs.map((run) => run.run.usage.tokens))).toEqual(
			new Set([0]),
		);
		expect(new Set(runs.map((run) => run.run.usage.costUsd))).toEqual(
			new Set([0]),
		);
		expect(runs.flatMap((run) => run.run.evidence.complete)).not.toContain(
			"events",
		);
		const unexpected = runs.filter(
			(run) =>
				run.result.status !== "pass" &&
				!(
					run.probe.id === "delegation/cli-no-dev-relay" &&
					run.result.status === "uncovered"
				),
		);
		expect(
			unexpected.map((run) => ({
				probe: run.probe.id,
				result: run.result,
				evidence: run.run.evidence,
			})),
		).toEqual([]);
		expect(
			runs
				.filter((run) => run.result.status !== "pass")
				.map((run) => [run.probe.id, run.result.status]),
		).toEqual([["delegation/cli-no-dev-relay", "uncovered"]]);
		expect(process.exitCode).toBe(1);
		await fastCli(
			["fast", "--kind", "cli", "--failed", "--directory", directory],
			log,
		);
		const reruns = await storedRuns(directory);
		expect(reruns).toHaveLength(12);
		expect(
			reruns.filter((run) => run.probe.id === "delegation/cli-no-dev-relay"),
		).toHaveLength(2);
		const report = new MemoryLogger();
		await fastCli(
			["report", "--kind", "agent", "--directory", directory],
			report,
		);
		expect(
			report.entries.map((entry) => entry.message).join("\n"),
		).not.toContain("lifecycle/cli-working");
	} finally {
		process.exitCode = exitCode ?? 0;
	}
}, 120000);

// scry-ignore simple-test-setup: this test alone substitutes inert seeds to isolate the ACP capability gate; it does not exercise aspect setup or model adherence.
it("rejects every registered agent probe without launching even with unmetered opt-in", async () => {
	const module = await loadModules([]);
	const fake = new FakeAgent();
	const runs = await runProbes(
		{
			probes: module.probes.filter((probe) => probe.execution.kind === "agent"),
			seeds: module.seeds.map((seed) => ({
				...seed,
				fingerprint: "synthetic-capability-gate",
				async prepare() {},
				async observe() {
					return {};
				},
			})),
		},
		[{ adapter: acpAdapter(AGENT, directory, fake.launch), model: "big" }],
		{
			directory,
			parallel: 2,
			reps: 1,
			skillHash: "synthetic",
			cliHash: "synthetic",
			reproduction: ["test"],
			allowUnmetered: true,
		},
	);
	expect(runs).toHaveLength(62);
	expect(new Set(runs.map((run) => run.result.status))).toEqual(
		new Set(["unsupported"]),
	);
	expect(fake.launched).toHaveLength(0);
	expect(new Set(runs.map((run) => run.run.usage.tokens))).toEqual(
		new Set([null]),
	);
});
