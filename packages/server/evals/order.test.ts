import { describe, expect, it } from "bun:test";
import type { EvalScenario } from "./launch";
import { lastRunByScenario, orderedScenarios } from "./order";
import type { EvalCell, EvalGrid, EvalTarget } from "./types";

describe("orderedScenarios", () => {
	it("orders by priority, then never run, then oldest last run", () => {
		const scenarios: EvalScenario[] = [
			scenario("low-never", "low"),
			scenario("normal-recent"),
			scenario("high-old", "high"),
			scenario("normal-never", "normal"),
			scenario("high-never", "high"),
			scenario("normal-old"),
		];
		const grids: EvalGrid[] = [
			grid("2026-11-01T00:00:00.000Z", [
				cell("high-old", "claude/opus"),
				cell("normal-old", "claude/opus"),
			]),
			grid("2026-11-10T00:00:00.000Z", [cell("normal-recent", "claude/opus")]),
		];

		const ordered = orderedScenarios(scenarios, grids);

		expect(
			ordered.map((each) => ({
				id: each.id,
				priority: each.priority,
				lastRunAt: each.lastRunAt,
			})),
		).toEqual([
			{ id: "high-never", priority: "high", lastRunAt: null },
			{
				id: "high-old",
				priority: "high",
				lastRunAt: "2026-11-01T00:00:00.000Z",
			},
			{ id: "normal-never", priority: "normal", lastRunAt: null },
			{
				id: "normal-old",
				priority: "normal",
				lastRunAt: "2026-11-01T00:00:00.000Z",
			},
			{
				id: "normal-recent",
				priority: "normal",
				lastRunAt: "2026-11-10T00:00:00.000Z",
			},
			{ id: "low-never", priority: "low", lastRunAt: null },
		]);
	});

	it("ignores pending cells and baseline targets when computing last run", () => {
		const scenarios: EvalScenario[] = [
			scenario("ran"),
			scenario("pending-only"),
			scenario("baseline-only"),
		];
		const grids: EvalGrid[] = [
			grid(
				"2026-11-05T00:00:00.000Z",
				[
					cell("ran", "claude/opus"),
					cell("pending-only", "claude/opus", true),
					cell("baseline-only", "claude/opus @main"),
				],
				[
					target("claude/opus", "claude", null),
					target("claude/opus @main", "claude", "main"),
				],
			),
		];

		const ordered = orderedScenarios(scenarios, grids);

		expect(ordered.map((each) => [each.id, each.lastRunAt])).toEqual([
			["pending-only", null],
			["baseline-only", null],
			["ran", "2026-11-05T00:00:00.000Z"],
		]);
	});

	it("scopes last run to one agent when filtered", () => {
		const scenarios: EvalScenario[] = [
			scenario("ran-on-both"),
			scenario("ran-on-codex-only"),
			scenario("ran-on-claude-older"),
		];
		const grids: EvalGrid[] = [
			grid(
				"2026-11-01T00:00:00.000Z",
				[cell("ran-on-claude-older", "claude/opus")],
				[target("claude/opus", "claude", null)],
			),
			grid(
				"2026-11-10T00:00:00.000Z",
				[
					cell("ran-on-both", "claude/opus"),
					cell("ran-on-both", "codex/gpt"),
					cell("ran-on-codex-only", "codex/gpt"),
				],
				[
					target("claude/opus", "claude", null),
					target("codex/gpt", "codex", null),
				],
			),
		];

		const forClaude = orderedScenarios(scenarios, grids, "claude");
		expect(forClaude.map((each) => [each.id, each.lastRunAt])).toEqual([
			["ran-on-codex-only", null],
			["ran-on-claude-older", "2026-11-01T00:00:00.000Z"],
			["ran-on-both", "2026-11-10T00:00:00.000Z"],
		]);

		const lastCodex = lastRunByScenario(grids, "codex");
		expect(lastCodex.get("ran-on-claude-older")).toBeUndefined();
		expect(lastCodex.get("ran-on-codex-only")?.at).toBe(
			"2026-11-10T00:00:00.000Z",
		);
	});
});

function scenario(
	id: string,
	priority?: "high" | "normal" | "low",
): EvalScenario {
	return {
		id,
		group: null,
		about: null,
		...(priority === undefined ? {} : { priority }),
	};
}

function target(key: string, agent: string, skill: string | null): EvalTarget {
	return { key, agent, model: null, effort: null, skill };
}

function cell(
	scenarioId: string,
	targetKey: string,
	pending = false,
): EvalCell {
	return {
		scenario: scenarioId,
		aspect: "",
		requirement: "",
		target: targetKey,
		repetition: 0,
		run: pending
			? null
			: {
					id: `b#${scenarioId}-${targetKey}`,
					status: "pass",
					tokens: null,
					costUsd: null,
					milliseconds: 0,
				},
	};
}

function grid(
	startedAt: string,
	cells: EvalCell[],
	targets: EvalTarget[] = [],
): EvalGrid {
	return {
		id: startedAt,
		skill: null,
		producer: null,
		startedAt,
		targets,
		tally: {},
		cells: cells.length,
		tokens: null,
		costUsd: null,
		results: [],
		grid: cells,
	};
}
