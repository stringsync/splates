import { describe, expect, it } from "bun:test";
import { scenarioStates } from "./states";
import type { EvalCell, EvalGrid } from "./types";

describe("scenarioStates", () => {
	it("tells failing, never run, stale and passing apart", () => {
		const states = scenarioStates(
			[list("f", "1"), list("n", "1"), list("s", "2"), list("p", "1")],
			[
				grid("2026-01-02", [
					cell("f", "fail", "1"),
					cell("s", "pass", "1"),
					cell("p", "pass", "1", "a"),
					cell("p", "fail", "1", "b"),
					cell("p", "pending", "1", "c"),
				]),
			],
		);
		expect(states.map((each) => each.state)).toEqual([
			"failing",
			"never-run",
			"stale",
			"failing",
		]);
		expect(states[3]?.targets).toEqual([
			{ target: "a", passed: 1, total: 1 },
			{ target: "b", passed: 0, total: 1 },
		]);
		expect(states[3]?.run).toBe("b#pb");
		expect(states[0]).toMatchObject({ lastRunAt: "2026-01-02" });
	});

	it("reads the latest batch and never marks an unstamped run stale", () => {
		const [first, second] = scenarioStates(
			[list("x", "9"), list("y", "9")],
			[
				grid("2026-01-01", [cell("x", "fail", "9")]),
				grid("2026-01-02", [
					cell("x", "pass", "9"),
					cell("y", "pass", undefined),
				]),
			],
		);
		expect(first?.state).toBe("passing");
		expect(second?.state).toBe("passing");
	});
});

function cell(
	scenario: string,
	status: "pass" | "fail" | "pending",
	fingerprint: string | undefined,
	target = "a",
): EvalCell {
	return {
		scenario,
		aspect: "",
		requirement: "",
		target,
		repetition: 0,
		...(fingerprint === undefined ? {} : { fingerprint }),
		run:
			status === "pending"
				? null
				: {
						id: `b#${scenario}${target}`,
						status,
						tokens: null,
						costUsd: null,
						milliseconds: 0,
					},
	};
}

function grid(startedAt: string, cells: EvalCell[]): EvalGrid {
	return {
		id: startedAt,
		skill: null,
		producer: null,
		startedAt,
		targets: [],
		tally: {},
		cells: cells.length,
		tokens: null,
		costUsd: null,
		grid: cells,
	};
}

function list(id: string, fingerprint?: string) {
	return {
		id,
		group: null,
		about: null,
		...(fingerprint === undefined ? {} : { fingerprint }),
	};
}
