import { describe, expect, it } from "bun:test";
import { baselines, findingKeys, measured, outlier } from "./baselines";
import type { Outcome } from "./outcomes";

describe("baselines", () => {
	it("gives each measure's median and 90th percentile over the week's merged tasks", () => {
		const [baseline] = baselines(
			[
				...Array.from({ length: 10 }, (_, index) =>
					merged(index + 1, { size: { files: 1, added: 10, removed: 0 } }),
				),
				merged(500, { endedAt: "2026-10-01T10:00:00.000Z" }),
				merged(500, { ended: "removed" }),
				merged(500, { base: "task/parent" }),
			],
			now,
		);

		expect(baseline).toMatchObject({
			project: "/repo",
			tasks: 10,
			measures: {
				spentMs: { tasks: 10, median: 5.5 * MINUTE, p90: 9.1 * MINUTE },
				lines: { tasks: 10, median: 10, p90: 10 },
				involvement: { tasks: 10, median: 0, p90: 0 },
				// Older outcomes kept no cost, so there is none to compare with.
				cost: null,
			},
		});
	});

	it("gives no comparison under ten tasks", () => {
		const [baseline] = baselines(
			Array.from({ length: 9 }, () => merged(5)),
			now,
		);

		expect(baseline?.measures.spentMs).toBeNull();
	});

	it("counts the tasks with each finding, once each, by kind and by what failed", () => {
		const [baseline] = baselines(
			[
				merged(5, {
					findings: [
						{
							kind: "gate",
							reason: "tests_failed",
							at: "",
							tests: ["adds up"],
						},
						{
							kind: "gate",
							reason: "tests_failed",
							at: "",
							tests: ["adds up"],
						},
					],
				}),
				merged(5, {
					findings: [
						{ kind: "gate", reason: "tests_failed", at: "", tests: ["rounds"] },
						{ kind: "stopped", at: "" },
					],
				}),
			],
			now,
		);

		expect(baseline?.findings).toEqual({
			"gate:tests_failed": 2,
			"gate:tests_failed:adds up": 1,
			"gate:tests_failed:rounds": 1,
			stopped: 1,
		});
	});

	it("marks a value past the 90th percentile or twice the median an outlier", () => {
		const spread = { tasks: 10, median: 10, p90: 30 };

		expect(outlier(25, spread)).toBe(true);
		expect(outlier(31, { ...spread, median: 20 })).toBe(true);
		expect(outlier(20, spread)).toBe(false);
		expect(outlier(100, null)).toBe(false);
	});

	it("reads a task's measures, absent where it kept none", () => {
		expect(
			measured(
				merged(3, {
					questionRounds: 1,
					reviewRounds: 1,
					usage: { input: 1, cached: 0, output: 1, cost: null },
				}),
			),
		).toEqual({
			spentMs: 3 * MINUTE,
			cost: null,
			lines: null,
			involvement: 2,
			failedMerges: 0,
		});
		expect(
			findingKeys({
				kind: "gate",
				reason: "conflict",
				at: "",
				files: ["a.ts"],
			}),
		).toEqual(["gate:conflict", "gate:conflict:a.ts"]);
	});
});

/** A merged task of `/repo`'s, `minutes` long, ended within the week. */
function merged(minutes: number, changes: Partial<Outcome> = {}): Outcome {
	return {
		project: "/repo",
		task: "alpha",
		base: "main",
		ended: "merged",
		startedAt: new Date(
			Date.parse("2026-10-14T10:00:00.000Z") - minutes * 60_000,
		).toISOString(),
		endedAt: "2026-10-14T10:00:00.000Z",
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		conversation: null,
		agent: null,
		model: null,
		...changes,
	};
}

const now = new Date("2026-10-14T12:00:00.000Z");
const MINUTE = 60_000;
