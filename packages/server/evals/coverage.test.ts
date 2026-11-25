import { describe, expect, it } from "bun:test";
import { coverage, nextAgents } from "./coverage";
import type { EvalGrid, EvalStatus, EvalTarget } from "./types";

describe("coverage", () => {
	const at = (grids: EvalGrid[]) =>
		coverage(["a"], picks, grids)[0]?.agents.map((each) => [
			each.agent,
			each.state,
			each.runsSincePass,
			each.skip,
		]);

	it("needs two passes in an agent's last three, and skips it for two runs after", () => {
		const first = batch(1, [
			["a", claude, "pass"],
			["a", codex, "fail"],
		]);
		const second = batch(2, [
			["a", claude, "pass"],
			["a", codex, "fail"],
		]);
		const third = batch(3, [["a", codex, "fail"]]);
		expect(at([first])).toEqual([
			["claude:sonnet", "needs-runs", 0, false],
			["codex:gpt", "needs-runs", null, false],
			["kimi:k3", "never-run", null, false],
		]);
		expect(at([first, second])?.slice(0, 2)).toEqual([
			["claude:sonnet", "passed", 0, true],
			["codex:gpt", "failing", null, false],
		]);
		expect(at([first, second, third])?.[0]).toEqual([
			"claude:sonnet",
			"passed",
			1,
			true,
		]);
	});

	it("counts an agent failing once its failures put a pass out of reach, and old failures age out", () => {
		const fails = [1, 2].map((minute) =>
			batch(minute, [["a", claude, "fail"]]),
		);
		expect(at(fails)?.[0]?.[1]).toBe("failing");
		const fixed = [3, 4].map((minute) =>
			batch(minute, [["a", claude, "pass"]]),
		);
		expect(at([...fails, ...fixed])?.[0]?.[1]).toBe("passed");
	});

	it("never counts a baseline's column or another scenario", () => {
		const [covered] = coverage(["a"], picks, [
			batch(1, [
				["a", target("claude", "sonnet", "main"), "pass"],
				["b", claude, "pass"],
			]),
		]);
		expect(covered?.agents[0]?.state).toBe("never-run");
	});

	it("leaves errored runs out, so an agent with only those needs runs", () => {
		const [covered] = coverage(["a"], picks, [
			batch(1, [
				["a", claude, "error"],
				["a", claude, "error"],
				["a", claude, "error"],
			]),
		]);
		expect(covered?.agents[0]?.state).toBe("needs-runs");
	});

	it("takes a spec's own rule", () => {
		const [covered] = coverage(
			["a"],
			picks.slice(0, 1),
			[batch(1, [["a", claude, "pass"]])],
			new Map([["a", { need: 1, of: 1 }]]),
		);
		expect(covered?.agents[0]?.state).toBe("passed");
	});
});

describe("nextAgents", () => {
	it("names failing agents first, then those needing runs or never run, leaving out recent passes", () => {
		const covered = coverage(["a", "b"], picks, [
			batch(1, [
				["a", claude, "pass"],
				["b", claude, "pass"],
				["a", codex, "pass"],
				["b", codex, "fail"],
			]),
			batch(2, [
				["a", claude, "pass"],
				["b", claude, "pass"],
				["a", codex, "pass"],
				["b", codex, "fail"],
			]),
		]);
		expect(nextAgents(covered)).toEqual(["codex:gpt", "kimi:k3"]);
	});

	it("names none once every agent passed recently", () => {
		const covered = coverage(["a"], picks.slice(0, 1), [
			batch(1, [["a", claude, "pass"]]),
			batch(2, [["a", claude, "pass"]]),
		]);
		expect(nextAgents(covered)).toEqual([]);
	});

	it("keeps asking for an agent with one lucky pass", () => {
		const covered = coverage(["a"], picks.slice(0, 1), [
			batch(1, [["a", claude, "pass"]]),
		]);
		expect(nextAgents(covered)).toEqual(["claude:sonnet"]);
	});
});

const target = (agent: string, model: string, skill: string | null = null) =>
	({
		key: `${agent}/${model}${skill === null ? "" : ` @${skill}`}`,
		agent,
		model,
		effort: null,
		skill,
	}) satisfies EvalTarget;

const claude = target("claude", "sonnet");
const codex = target("codex", "gpt");
const picks = [
	{ agent: "claude", model: "sonnet" },
	{ agent: "codex", model: "gpt" },
	{ agent: "kimi", model: "k3" },
];

/** A batch at minute `at` whose cells are `[scenario, target, status]`. */
function batch(
	at: number,
	cells: [string, EvalTarget, EvalStatus][],
): EvalGrid {
	const id = `batch-${at}`;
	return {
		id,
		skill: "splates",
		producer: "splates",
		startedAt: `2026-11-24T00:${String(at).padStart(2, "0")}:00.000Z`,
		targets: [...new Set(cells.map(([, each]) => each))],
		tally: {},
		cells: cells.length,
		tokens: null,
		costUsd: null,
		results: [],
		grid: cells.map(([scenario, each, status], index) => ({
			scenario,
			aspect: "",
			requirement: "",
			target: each.key,
			repetition: 0,
			run: {
				id: `${id}#run-${index}`,
				status,
				tokens: null,
				costUsd: null,
				milliseconds: 1,
			},
		})),
	};
}
