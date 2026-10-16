import { describe, expect, it } from "bun:test";
import { factTodos } from "./finding-facts";
import type { Finding } from "./findings";
import type { Outcome } from "./outcomes";

describe("factTodos", () => {
	it("makes a todo of each fact, the gate's first, with the data it came from", () => {
		const stopped = {
			kind: "stopped",
			at: "2026-10-14T09:30:00.000Z",
		} as const;
		const conflict: Finding = {
			kind: "gate",
			reason: "conflict",
			at: "",
			files: ["a.ts"],
		};

		const todos = factTodos({
			outcome: merged({ findings: [stopped, conflict] }),
			baseline: null,
		});

		expect(todos).toEqual([
			{
				subject: "Conflicted in a.ts",
				text: [
					"Found in `alpha` as it merged: Conflicted in a.ts.",
					"",
					"```json",
					JSON.stringify(conflict, null, 2),
					"```",
				].join("\n"),
			},
			{
				subject: "You stopped a turn",
				text: [
					"Found in `alpha` as it merged: You stopped a turn.",
					"",
					"```json",
					JSON.stringify(stopped, null, 2),
					"```",
				].join("\n"),
			},
		]);
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
