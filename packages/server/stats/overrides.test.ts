import { expect, test } from "bun:test";
import type { Outcome } from "./outcomes";
import { overridesByRule } from "./overrides";

function outcome(overrides: Outcome["overrides"]): Outcome {
	return { overrides } as Outcome;
}

const at = "2026-10-21T00:00:00.000Z";

test("counts overrides by rule with where they moved to, most first", () => {
	const rows = overridesByRule([
		outcome([
			{ aspect: "model", to: "opus", at, rule: 2, kind: "design", depth: null },
		]),
		outcome(undefined),
		outcome([
			{ aspect: "model", to: "opus", at, rule: 2, kind: "design", depth: null },
			{
				aspect: "effort",
				to: "high",
				at,
				rule: 2,
				kind: "design",
				depth: null,
			},
			{ aspect: "model", to: "opus", at, rule: 0, kind: null, depth: null },
		]),
	]);
	expect(rows).toEqual([
		{
			rule: 2,
			count: 3,
			moves: [
				{ aspect: "model", to: "opus", count: 2 },
				{ aspect: "effort", to: "high", count: 1 },
			],
		},
		{ rule: 0, count: 1, moves: [{ aspect: "model", to: "opus", count: 1 }] },
	]);
});
