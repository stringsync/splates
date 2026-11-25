import { expect, test } from "bun:test";
import { diagnosesOf } from "./diagnosis";
import { testResults } from "./results";
import type { EvalCell, EvalStatus } from "./types";

test("counts passes over graded runs and groups failures by diagnosis", () => {
	const diagnoses = diagnosesOf(
		"Diagnosis:\n- run-001, run-003 asks: skill\n  - Why: The trigger misses webhooks.\n  - Proposed remedy: Name webhooks.",
	);
	const [sonnet, kimi, opus] = testResults(GRID, diagnoses);
	expect(sonnet).toMatchObject({
		scenario: "creds",
		target: "sonnet",
		passed: 1,
		graded: 4,
		errored: 0,
		firstFailed: "b#run-001",
	});
	expect(sonnet?.failures).toEqual([
		{
			kind: "diagnosed",
			runs: ["b#run-001", "b#run-003"],
			check: "asks",
			causes: ["skill"],
			why: "The trigger misses webhooks.",
			did: null,
			remedy: { text: "Name webhooks.", state: "proposed" },
		},
		expect.objectContaining({
			kind: "undiagnosed",
			runs: ["b#run-002"],
			why: null,
		}),
	]);
	expect(kimi).toMatchObject({ passed: 1, graded: 2, errored: 1 });
	expect(kimi?.failures.map((each) => [each.kind, each.causes])).toEqual([
		["harness", ["harness"]],
		["undiagnosed", []],
	]);
	expect(opus).toMatchObject({
		scenario: "other",
		passed: 1,
		firstFailed: null,
		failures: [],
	});
});

test("leaves every failure undiagnosed without remarks", () => {
	const [sonnet] = testResults(GRID, null);
	expect(sonnet?.failures).toEqual([
		expect.objectContaining({
			kind: "undiagnosed",
			runs: ["b#run-001", "b#run-002", "b#run-003"],
		}),
	]);
});

function cell(
	index: number,
	target: string,
	status: EvalStatus,
	scenario = "creds",
): EvalCell {
	return {
		scenario,
		aspect: "",
		requirement: "",
		target,
		repetition: index,
		run: {
			id: `b#run-${String(index).padStart(3, "0")}`,
			status,
			tokens: null,
			costUsd: null,
			milliseconds: 0,
		},
	};
}

const GRID = [
	cell(0, "sonnet", "pass"),
	cell(1, "sonnet", "fail"),
	cell(2, "sonnet", "fail"),
	cell(3, "sonnet", "fail"),
	cell(4, "kimi", "fail"),
	cell(5, "kimi", "error"),
	cell(6, "kimi", "pass"),
	cell(7, "opus", "pass", "other"),
];
