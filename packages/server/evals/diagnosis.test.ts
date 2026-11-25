import { expect, test } from "bun:test";
import { diagnosesOf, withoutDiagnosis } from "./diagnosis";

const REMARKS = [
	"Round 2: one failure, Sonnet only.",
	"",
	"Diagnosis:",
	"- run-017, run-019 asks-through-creds: skill, judge",
	"  - Why: The creds trigger names tokens and keys but not webhook URLs,",
	"    so Sonnet 5.5 didn't treat the webhook as a secret.",
	"  - Did: Step 2 asked for the webhook URL in `chat. Here`.",
	"  - Proposed remedy: Name webhook URLs in the creds trigger.",
	"",
	"- `run-020` leaves-env: harness",
	"  - Why: The sandbox lost its .env before grading.",
	"  - Applied remedy: Copy .env into the sandbox, e.g. in setup.",
	"",
	"What held up: the Merged rule.",
].join("\n");

test("reads each entry's runs, check, causes, why, did and remedy", () => {
	expect(diagnosesOf(REMARKS)).toEqual([
		{
			runs: ["run-017", "run-019"],
			check: "asks-through-creds",
			causes: ["skill", "judge"],
			why: "The creds trigger names tokens and keys but not webhook URLs, so Sonnet 5.5 didn't treat the webhook as a secret.",
			did: {
				text: "Step 2 asked for the webhook URL in `chat. Here`.",
				step: 1,
			},
			remedy: {
				text: "Name webhook URLs in the creds trigger.",
				state: "proposed",
			},
		},
		{
			runs: ["run-020"],
			check: "leaves-env",
			causes: ["harness"],
			why: "The sandbox lost its .env before grading.",
			did: null,
			remedy: {
				text: "Copy .env into the sandbox, e.g. in setup.",
				state: "applied",
			},
		},
	]);
});

test("takes the list out of the prose", () => {
	expect(withoutDiagnosis(REMARKS)).toBe(
		"Round 2: one failure, Sonnet only.\n\nWhat held up: the Merged rule.",
	);
});

test("is null without a Diagnosis list", () => {
	expect(diagnosesOf("Faults:\n- run-000: judge")).toBeNull();
});

test("refuses a cause outside the four", () => {
	expect(() =>
		diagnosesOf("Diagnosis:\n- run-000 asks: agent\n  - Why: It slipped."),
	).toThrow(/"agent" .* is no cause: use harness, judge, skill, eval/u);
});

test("refuses a why, did or remedy longer than one sentence", () => {
	expect(() =>
		diagnosesOf(
			"Diagnosis:\n- run-000 asks: skill\n  - Why: It never asked. It guessed.",
		),
	).toThrow(/Why .* is 2 sentences: say it in one/u);
	expect(() =>
		diagnosesOf(
			"Diagnosis:\n- run-000 asks: skill\n  - Why: It guessed.\n  - Proposed remedy: Say so. Rerun it.",
		),
	).toThrow(/remedy .* is 2 sentences/u);
});

test("refuses an entry without a Why, or with two remedies", () => {
	expect(() => diagnosesOf("Diagnosis:\n- run-000 asks: skill")).toThrow(
		/has no Why/u,
	);
	expect(() =>
		diagnosesOf(
			"Diagnosis:\n- run-000 asks: skill\n  - Why: It guessed.\n  - Proposed remedy: Say so.\n  - Applied remedy: Said so.",
		),
	).toThrow(/a proposed and an applied remedy/u);
});

test("refuses an entry that names no check", () => {
	expect(() =>
		diagnosesOf("Diagnosis:\n- run-000: skill\n  - Why: It guessed."),
	).toThrow(/is not "- <run>/u);
});
