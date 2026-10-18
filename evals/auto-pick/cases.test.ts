import { describe, expect, it } from "bun:test";
import type { Judge, Judgment } from "@stringsync/splates-server/auto-pick";
import { CASES, score } from "./cases";

/** Answers every question of every prompt the same, as `answers` says. */
function constant(answers: Record<string, number>): Judge {
	return {
		async judge(judgment: Judgment) {
			return {
				answers: new Map(
					Object.keys(judgment.questions).map((id) => [id, answers[id] ?? 0]),
				),
			};
		},
	};
}

describe("score", () => {
	it("labels every tier", () => {
		expect(new Set(CASES.map((each) => each.tier))).toEqual(
			new Set([1, 2, 3, 4]),
		);
	});

	it("counts exact and near tiers, listing each miss", async () => {
		const cases = [
			{ prompt: "a", tier: 3 },
			{ prompt: "b", tier: 2 },
			{ prompt: "c", tier: 1 },
		];
		const result = await score(constant({ design: 0.9 }), cases);
		expect(result).toEqual({
			total: 3,
			exact: 1,
			near: 2,
			misses: [
				{ prompt: "b", tier: 2, got: 3 },
				{ prompt: "c", tier: 1, got: 3 },
			],
		});
	});
});
