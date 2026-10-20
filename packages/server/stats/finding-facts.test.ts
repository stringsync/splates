import { describe, expect, it } from "bun:test";
import { factTasks } from "./finding-facts";
import { type Finding, findings } from "./findings";
import type { Outcome } from "./outcomes";

describe("factTasks", () => {
	it("files slow-test tasks only above 20 seconds", () => {
		const found = findings({
			gateFailures: [],
			retries: 0,
			picksOverturned: 0,
			log: null,
			landedLines: null,
			adherence: null,
			testTimes: [
				{ name: "old noise", seconds: 5.1 },
				{ name: "below", seconds: 19.9 },
				{ name: "boundary", seconds: 20 },
				{ name: "slow", seconds: 20.1 },
			],
		});
		expect(
			factTasks({
				outcome: merged({ findings: found }),
				baseline: null,
			}).map((each) => each.subject),
		).toEqual(["Slow test: slow"]);
	});

	it("makes a task of each gate run that named failing tests, with the data it came from", () => {
		const failed: Finding = {
			kind: "gate",
			reason: "tests_failed",
			at: "",
			tests: ["adds up"],
		};

		const tasks = factTasks({
			outcome: merged({
				findings: [{ kind: "stopped", at: "2026-10-14T09:30:00.000Z" }, failed],
			}),
			baseline: null,
		});

		expect(tasks).toEqual([
			{
				subject: "Tests failed: adds up",
				text: [
					"Found in `alpha` as it merged: Tests failed: adds up.",
					"",
					"```json",
					JSON.stringify(failed, null, 2),
					"```",
				].join("\n"),
			},
		]);
	});

	it("makes a separate task for each test in a failed gate so later gates deduplicate them", () => {
		const tasks = factTasks({
			outcome: merged({
				findings: [
					{
						kind: "gate",
						reason: "tests_failed",
						at: "",
						tests: ["adds up", "counts"],
					},
				],
			}),
			baseline: null,
		});

		expect(tasks.map((task) => task.subject)).toEqual([
			"Tests failed: adds up",
			"Tests failed: counts",
		]);
	});

	it("makes a task of each slow test", () => {
		const tasks = factTasks({
			outcome: merged({
				findings: [
					{
						kind: "slow_tests",
						tests: [
							{ name: "a > crawls", file: "a.test.ts", seconds: 29.25 },
							{ name: "b > drags", seconds: 26 },
						],
					},
				],
			}),
			baseline: null,
		});

		expect(tasks.map((each) => each.subject)).toEqual([
			"Slow test: a > crawls",
			"Slow test: b > drags",
		]);
		expect(tasks[0]?.text).toStartWith(
			"Found in `alpha` as it merged: the gate's passing run took 29.3s on `a > crawls` in `a.test.ts`, over the 20s bar.",
		);
	});

	it("makes none of what every merge goes through", () => {
		expect(
			factTasks({
				outcome: merged({
					failedMerges: 1,
					findings: [
						{ kind: "gate", reason: "conflict", at: "", files: ["a.ts"] },
						{ kind: "gate", reason: "tests_failed", at: "", tests: [] },
						{ kind: "gate", reason: "budget_exhausted", at: "" },
						{ kind: "retried", times: 2 },
						{ kind: "interrupted", at: "2026-10-14T09:30:00.000Z" },
						{ kind: "stopped", at: "2026-10-14T09:30:00.000Z" },
						{ kind: "overturned", picks: 2 },
					],
				}),
				baseline: null,
			}),
		).toEqual([]);
	});

	it("makes none of a merge that went as it could", () => {
		expect(
			factTasks({ outcome: merged({ findings: [] }), baseline: null }),
		).toEqual([]);
	});
});

/** A merged task; a test overrides what it is about. */
function merged(changes: Partial<Outcome>): Outcome {
	return {
		project: "/repo",
		task: "alpha",
		base: "main",
		ended: "merged",
		startedAt: "2026-10-14T09:20:00.000Z",
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
