import { expect, test } from "bun:test";
import type { Outcome } from "./outcomes";
import { overridesByCell, overridesByLineup } from "./overrides";

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

test("keeps each lineup's moves together and retains overrides with no lineup", () => {
	const move = {
		aspect: "model" as const,
		to: "opus",
		at,
		from: sonnet,
		result: opus,
		kind: "bugfix",
		depth: "shallow",
	};
	const astra = { model: "6 Astra", effort: "high" };
	const gemini = { model: "Gemini 4 Neon", effort: null };
	const rows = overridesByLineup(
		[
			outcome([{ ...move, lineup: "quick" }]),
			{
				...outcome([move]),
				autoPick: {
					lineup: "quick",
					kind: move.kind,
					depth: move.depth,
					agent: "claude",
					model: "sonnet",
					effort: "medium",
					lifts: [],
				},
			},
			outcome([{ ...move, lineup: "careful", from: astra, result: gemini }]),
			outcome([{ ...move, from: undefined, result: undefined, rule: 2 }]),
		],
		[],
	);
	expect(rows).toEqual([
		{
			kind: "bugfix",
			depth: "shallow",
			lineup: "quick",
			count: 2,
			earlier: 0,
			moves: [
				{
					from: sonnet,
					to: opus,
					count: 2,
					fromProvider: "anthropic",
					toProvider: "anthropic",
				},
			],
		},
		{
			kind: "bugfix",
			depth: "shallow",
			lineup: "careful",
			count: 1,
			earlier: 0,
			moves: [
				{
					from: astra,
					to: gemini,
					count: 1,
					fromProvider: "openai",
					toProvider: "google",
				},
			],
		},
		{
			kind: "bugfix",
			depth: "shallow",
			lineup: null,
			count: 1,
			earlier: 1,
			moves: [],
		},
	]);
});
