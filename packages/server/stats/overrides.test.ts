import { expect, test } from "bun:test";
import type { Outcome } from "./outcomes";
import { overridesByCell, overridesTaskText } from "./overrides";

function outcome(overrides: Outcome["overrides"]): Outcome {
	return { overrides } as Outcome;
}

const at = "2026-10-21T00:00:00.000Z";
const sonnet = { model: "Sonnet 5.5", effort: "medium" };
const opus = { model: "Opus 5.5", effort: "high" };

test("counts a task's model and effort changes as one move between pairings, most first", () => {
	const rows = overridesByCell([
		outcome([
			{ aspect: "model", to: "opus", at, rule: 2, kind: "design", depth: null },
		]),
		outcome(undefined),
		outcome([
			{
				aspect: "model",
				to: "Opus 5.5",
				at,
				from: sonnet,
				result: { model: "Opus 5.5", effort: "medium" },
				kind: "design",
				depth: null,
			},
			{
				aspect: "effort",
				to: "high",
				at,
				from: { model: "Opus 5.5", effort: "medium" },
				result: opus,
				kind: "design",
				depth: null,
			},
		]),
		outcome([
			{
				aspect: "model",
				to: "Opus 5.5",
				at,
				from: { model: "Sonnet 5.5", effort: "high" },
				result: opus,
				kind: null,
				depth: "deep",
			},
		]),
	]);
	expect(rows).toEqual([
		{
			kind: "design",
			depth: "unsure",
			count: 2,
			earlier: 1,
			moves: [{ from: sonnet, to: opus, count: 1 }],
		},
		{
			kind: "unsure",
			depth: "deep",
			count: 1,
			earlier: 0,
			moves: [
				{ from: { model: "Sonnet 5.5", effort: "high" }, to: opus, count: 1 },
			],
		},
	]);
});

test("words the board task from each cell's moves, none when nothing was overridden", () => {
	expect(overridesTaskText([])).toBeNull();
	const text = overridesTaskText([
		{
			kind: "bugfix",
			depth: "deep",
			count: 4,
			earlier: 1,
			moves: [{ from: sonnet, to: opus, count: 3 }],
		},
	]);
	expect(text).toContain("- bugfix at deep depth: 4 overridden");
	expect(text).toContain("Sonnet 5.5 · medium to Opus 5.5 · high, 3 times");
	expect(text).toContain("1 earlier, with no pairing recorded");
});
