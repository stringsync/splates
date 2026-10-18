import { describe, expect, it } from "bun:test";
import { factTodos } from "./finding-facts";
import type { Finding } from "./findings";
import type { Outcome } from "./outcomes";

describe("factTodos", () => {
	it("makes a todo of each gate run that named failing tests, with the data it came from", () => {
		const failed: Finding = {
			kind: "gate",
			reason: "tests_failed",
			at: "",
			tests: ["adds up"],
		};

		const todos = factTodos({
			outcome: merged({
				findings: [{ kind: "stopped", at: "2026-10-14T09:30:00.000Z" }, failed],
			}),
			baseline: null,
		});

		expect(todos).toEqual([
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

	it("makes a todo of each slow test", () => {
		const todos = factTodos({
			outcome: merged({
				findings: [
					{
						kind: "slow_tests",
						tests: [
							{ name: "a > crawls", file: "a.test.ts", seconds: 9.25 },
							{ name: "b > drags", seconds: 6 },
						],
					},
				],
			}),
			baseline: null,
		});

		expect(todos.map((todo) => todo.subject)).toEqual([
			"Slow test: a > crawls",
			"Slow test: b > drags",
		]);
		expect(todos[0]?.text).toStartWith(
			"Found in `alpha` as it merged: the gate's passing run took 9.3s on `a > crawls` in `a.test.ts`, over the 5s bar.",
		);
	});

	it("makes none of what every merge goes through", () => {
		expect(
			factTodos({
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
			factTodos({ outcome: merged({ findings: [] }), baseline: null }),
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
