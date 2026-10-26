import { describe, expect, test } from "bun:test";
import type { Event, Facts } from "../records";
import { ESTIMATED_FROM, mergeEstimates } from "./estimates";

function merged(
	facts: Partial<Facts["merge"]>,
	reason: string | null = null,
): Event {
	return { action: "merge", reason, ...facts } as unknown as Event;
}

describe("mergeEstimates", () => {
	test("gives each step and phase the median of the merges that timed it", () => {
		const gate = (tests: number) => ({
			workers: 8,
			load: 1,
			ms: { biome: 1000, tests, "server tests": tests, setup: 500 },
			within: { "server tests": "tests" },
		});
		const estimates = mergeEstimates([
			merged({
				stepsMs: { rebase: 1000, test: 60_000 },
				capacityWaitMs: 0,
				gate: gate(50_000),
			}),
			merged({
				stepsMs: { rebase: 3000, wait: 9000, test: 90_000 },
				capacityWaitMs: 9000,
				gate: gate(80_000),
			}),
			merged({
				stepsMs: { rebase: 2000, test: 70_000 },
				capacityWaitMs: 1000,
				gate: gate(60_000),
			}),
		]);
		expect(estimates).toEqual({
			steps: { rebase: 2000, wait: 1000, test: 70_000 },
			phases: [
				{ phase: "biome", ms: 1000 },
				{ phase: "tests", ms: 60_000 },
				{ phase: "server tests", ms: 60_000, within: "tests" },
			],
			merges: 3,
		});
	});

	test("takes a gated merge from before steps were timed by its wait and gate", () => {
		const estimates = mergeEstimates([
			merged({
				capacityWaitMs: 4000,
				gateMs: 30_000,
				gate: { workers: 8, load: 1, ms: { setup: 30_000 } },
			}),
			merged({ capacityWaitMs: 0, gateMs: 0 }),
		]);
		expect(estimates.steps).toEqual({ wait: 4000, test: 30_000 });
		expect(estimates.phases).toEqual([]);
	});

	test("counts only the last landed merges", () => {
		const estimates = mergeEstimates([
			merged({ stepsMs: { land: 1_000_000 } }),
			...Array.from({ length: ESTIMATED_FROM }, () =>
				merged({ stepsMs: { land: 100 } }),
			),
			merged({ stepsMs: { land: 1_000_000 } }, "tests_failed"),
		]);
		expect(estimates.steps).toEqual({ land: 100 });
		expect(estimates.merges).toBe(ESTIMATED_FROM);
	});
});
