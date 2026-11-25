import { describe, expect, it } from "bun:test";
import { scenarioStates } from "./states";
import type { EvalCell, EvalGrid } from "./types";

describe("scenarioStates", () => {
	it("tells failing, needs runs, never run and passing apart", () => {
		const states = scenarioStates(
			[list("f", "1"), list("n", "1"), list("s", "2"), list("p", "1")],
			[
				grid("2026-01-01", [
					cell("f", "fail", "1"),
					cell("s", "pass", "1"),
					cell("p", "pass", "1", "a"),
					cell("p", "pass", "1", "b"),
				]),
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
			"passing",
			"needs-runs",
		]);
		expect(states[3]?.targets).toEqual([
			{ target: "a", passed: 2, total: 2, standing: "pass", need: 2, of: 3 },
			{
				target: "b",
				passed: 1,
				total: 2,
				standing: "needs-runs",
				need: 2,
				of: 3,
			},
		]);
		expect(states[0]).toMatchObject({ lastRunAt: "2026-01-02" });
		expect(states[1]?.batch).toBeNull();
	});

	it("one lucky pass needs runs, and old failures age out of the window", () => {
		const [lucky, mended] = scenarioStates(
			[list("x", "9"), list("y", "9")],
			[
				grid("2026-01-01", [cell("x", "fail", "9"), cell("y", "fail", "9")]),
				grid("2026-01-02", [cell("x", "pass", "9"), cell("y", "fail", "9")]),
				grid("2026-01-03", [cell("y", "pass", "9"), cell("y", "pass", "9")]),
			],
		);
		expect(lucky?.state).toBe("needs-runs");
		expect(lucky?.batch).toBe("2026-01-02");
		expect(mended?.state).toBe("passing");
	});

	it("uses a spec's own rule", () => {
		const [one] = scenarioStates(
			[{ ...list("x", "9"), pass: { need: 1, of: 1 } }],
			[grid("2026-01-01", [cell("x", "pass", "9")])],
		);
		expect(one?.state).toBe("passing");
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
		results: [],
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
