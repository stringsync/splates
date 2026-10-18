import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import decisions from "./decisions.probes";
import type { Probe } from "./probe";
import { declared } from "./probe-budget-policy";
import { EvalBudgets } from "./probe-budget-store";
import { storedRuns } from "./probe-cli";
import { pairedBatchReport } from "./probe-pair";
import { type Adapter, runProbes, type Target } from "./runner";

it.each(["unsupported", "infrastructure-error", "bound"] as const)(
	"retains all paired cells and one shared reservation after %s",
	async (termination) => {
		const adapter: Adapter = {
			id: "free",
			version: "1",
			config: {},
			tokenBound: true,
			async run() {
				throw new Error("unmetered path");
			},
			metering: {
				quote: () => ({ tokens: 100, microUsd: 1000 }),
				async run(context) {
					launches++;
					expect((await ledger.report()).windows[0]?.reserved).toBe(400);
					expect(
						JSON.parse(
							await readFile(join(directory, "experiment.json"), "utf8"),
						).jobs,
					).toHaveLength(4);
					context.runtime.nativeUsageComplete = false;
					context.trace({ free: true });
					context.evidence.termination = termination;
					// scry-ignore matchers-over-test-logic: this branch scripts the injected transport failure, not a conditional assertion.
					if (termination === "infrastructure-error") {
						throw new Error("free infrastructure refusal");
					}
				},
			},
		};
		const targets: Target[] = ["codex", "claude"].flatMap((family) =>
			(["baseline", "candidate"] as const).map((role) => ({
				adapter: { ...adapter, id: family },
				model: "fixture",
				snapshot: { role, hash: role },
			})),
		);
		const results = await runProbes(
			{
				probes: [probe],
				seeds: [
					{
						id: probe.seed.id,
						version: probe.seed.version,
						fingerprint: "free",
						async prepare() {},
						async observe() {
							return {};
						},
					},
				],
			},
			targets,
			{
				directory,
				parallel: 1,
				reps: 1,
				skillHash: "unused",
				cliHash: "fixture",
				reproduction: [],
				budget: { tokens: 400, microUsd: 4000 },
				sharedBudget: ledger,
				stopOnFailure: true,
				experiment: { kind: "paired", free: true },
			},
		);
		expect(launches).toBe(1);
		expect(results).toHaveLength(4);
		expect(results.map((value) => value.run.identity.skillHash)).toEqual([
			"baseline",
			"candidate",
			"baseline",
			"candidate",
		]);
		expect(results.slice(1).map((value) => value.run.evidence.detail)).toEqual([
			"cancelled before start",
			"cancelled before start",
			"cancelled before start",
		]);
		expect(await storedRuns(directory)).toHaveLength(4);
		expect((await ledger.report()).reservations).toHaveLength(1);
		expect((await ledger.report()).windows[0]?.reserved).toBe(400);
		expect(pairedBatchReport(results)).toContain("cancelled before start");
	},
);

it("reserves and persists both unchanged-baseline cells before the first launch and keeps cancellation", async () => {
	const adapter: Adapter = {
		id: "free",
		version: "1",
		config: {},
		tokenBound: true,
		async run() {
			throw new Error("unmetered path");
		},
		metering: {
			quote: () => ({ tokens: 100, microUsd: 1000 }),
			async run(context) {
				launches++;
				expect((await ledger.report()).windows[0]?.reserved).toBe(200);
				const manifest = JSON.parse(
					await readFile(join(directory, "experiment.json"), "utf8"),
				);
				expect(manifest.experiment.kind).toBe("unchanged-baseline");
				expect(manifest.jobs).toHaveLength(2);
				expect(
					manifest.jobs.map((job: { snapshot: unknown }) => job.snapshot),
				).toEqual([
					{ role: "current", hash: "same" },
					{ role: "current", hash: "same" },
				]);
				context.runtime.nativeUsageComplete = false;
				context.evidence.termination = "unsupported";
			},
		},
	};
	const results = await runProbes(
		{
			probes: [probe],
			seeds: [
				{
					id: probe.seed.id,
					version: probe.seed.version,
					fingerprint: "free",
					async prepare() {},
					async observe() {
						return {};
					},
				},
			],
		},
		["codex", "claude"].map((id) => ({
			adapter: { ...adapter, id },
			model: "fixture",
			snapshot: { role: "current" as const, hash: "same" },
		})),
		{
			directory,
			parallel: 1,
			reps: 1,
			skillHash: "same",
			cliHash: "fixture",
			reproduction: ["free", "--unchanged-baseline"],
			budget: { tokens: 200, microUsd: 2000 },
			sharedBudget: ledger,
			stopOnFailure: true,
			experiment: { kind: "unchanged-baseline", free: true },
		},
	);
	expect(launches).toBe(1);
	expect(results).toHaveLength(2);
	expect(results[1]?.run.evidence.detail).toBe("cancelled before start");
	expect(await storedRuns(directory)).toHaveLength(2);
	expect((await ledger.report()).reservations).toHaveLength(1);
	expect((await ledger.report()).windows[0]?.reserved).toBe(200);
	expect(pairedBatchReport(results)).toContain("no candidate comparison");
});

let directory: string;
let ledger: EvalBudgets;
let launches: number;
const probe = decisions.probes[0] as Probe;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "paired-experiment-"));
	ledger = new EvalBudgets(
		join(directory, "ledger.json"),
		declared({ tokens: 400, per: "day" }, "free"),
	);
	launches = 0;
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
