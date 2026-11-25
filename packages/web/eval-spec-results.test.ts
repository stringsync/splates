import { describe, expect, it } from "bun:test";
import type {
	EvalDetail,
	EvalFailure,
	EvalGrid,
	EvalScenario,
	EvalTarget,
} from "@splates/server/evals/browser";
import {
	buildFailureTimeline,
	doneAsideText,
	formatRunNumbers,
	remediesSummary,
	summarizeTests,
	targetDisplay,
} from "./eval-spec-data";

describe("targetDisplay", () => {
	it("formats Claude, bare agent, and Antigravity Gemini targets with the right logos", () => {
		expect(targetDisplay(SONNET)).toEqual({
			markAgent: "claude",
			label: "Sonnet 4.5",
		});
		expect(targetDisplay(KIMI)).toEqual({
			markAgent: "kimi",
			label: "Kimi",
		});
		expect(targetDisplay(ANTIGRAVITY)).toEqual({
			markAgent: "antigravity",
			label: "Gemini 3 Pro",
		});
	});
});

describe("targetDisplay with a provider-prefixed model", () => {
	it("drops the provider prefix", () => {
		expect(targetDisplay({ ...KIMI, model: "kimi-code/k3.1-pro" }).label).toBe(
			"K3.1 Pro",
		);
	});
});

describe("formatRunNumbers", () => {
	it("formats 1, 2, and 3+ run numbers cleanly", () => {
		expect(formatRunNumbers([3])).toBe("run 3");
		expect(formatRunNumbers([4, 5])).toBe("runs 4 and 5");
		expect(formatRunNumbers([7, 4, 5])).toBe("runs 4, 5 and 7");
		expect(formatRunNumbers([], 2)).toBe("2 runs");
	});
});

describe("summarizeTests", () => {
	it("computes pass rate over graded runs, ignores errored runs, and groups failures with causes", () => {
		const scenarios: EvalScenario[] = [
			{
				id: "creds/webhook",
				group: "creds",
				about: "reads creds.md before asking for a secret",
				prompt: "Hook the deploy notifier up to our Slack webhook.",
			},
			{
				id: "asking/prefs",
				group: "asking",
				about: "asks product preferences in one questions card",
				prompt: "Build a dashboard.",
			},
		];
		const grid: EvalGrid = {
			id: "batch-1",
			skill: "splates skill",
			producer: "splates",
			startedAt: "2026-11-24T00:00:00.000Z",
			targets: [SONNET, KIMI, ANTIGRAVITY],
			tally: { pass: 8, fail: 2, error: 1 },
			cells: 11,
			tokens: 1000,
			costUsd: 9.4,
			grid: [
				cell("creds/webhook", SONNET.key, 0, "pass", "r1"),
				cell("creds/webhook", SONNET.key, 1, "fail", "r2"),
				cell("creds/webhook", SONNET.key, 2, "fail", "r3"),
				cell("creds/webhook", KIMI.key, 0, "pass", "r4"),
				cell("creds/webhook", KIMI.key, 1, "pass", "r5"),
				cell("creds/webhook", KIMI.key, 2, "pass", "r6"),
				cell("creds/webhook", ANTIGRAVITY.key, 0, "pass", "r7"),
				cell("creds/webhook", ANTIGRAVITY.key, 1, "error", "r8"),
				cell("asking/prefs", SONNET.key, 0, "pass", "r9"),
				cell("asking/prefs", KIMI.key, 0, "pass", "r10"),
				cell("asking/prefs", ANTIGRAVITY.key, 0, "pass", "r11"),
			],
			results: [
				{
					scenario: "creds/webhook",
					target: SONNET.key,
					passed: 1,
					graded: 3,
					errored: 0,
					firstFailed: "batch-1#r2",
					failures: [
						{
							kind: "diagnosed",
							runs: ["batch-1#r2", "batch-1#r3"],
							check: "asks-through-creds",
							causes: ["skill"],
							why: "The creds trigger names tokens but not webhook URLs.",
							did: { text: "asked in chat", step: 1 },
							remedy: {
								text: "name webhook URLs in the creds trigger",
								state: "proposed",
							},
						},
					],
				},
				{
					scenario: "creds/webhook",
					target: KIMI.key,
					passed: 3,
					graded: 3,
					errored: 0,
					firstFailed: null,
					failures: [],
				},
				{
					scenario: "creds/webhook",
					target: ANTIGRAVITY.key,
					passed: 1,
					graded: 1,
					errored: 1,
					firstFailed: "batch-1#r8",
					failures: [
						{
							kind: "harness",
							runs: ["batch-1#r8"],
							check: null,
							causes: ["harness"],
							why: null,
							did: null,
							remedy: null,
						},
					],
				},
				{
					scenario: "asking/prefs",
					target: SONNET.key,
					passed: 1,
					graded: 1,
					errored: 0,
					firstFailed: null,
					failures: [],
				},
				{
					scenario: "asking/prefs",
					target: KIMI.key,
					passed: 1,
					graded: 1,
					errored: 0,
					firstFailed: null,
					failures: [],
				},
				{
					scenario: "asking/prefs",
					target: ANTIGRAVITY.key,
					passed: 1,
					graded: 1,
					errored: 0,
					firstFailed: null,
					failures: [],
				},
			],
		};

		const tests = summarizeTests(grid, scenarios);
		expect(tests).toHaveLength(2);

		const [creds, prefs] = tests;
		expect(creds?.sentence).toBe("reads creds.md before asking for a secret");
		expect(creds?.prompt).toBe(
			"Hook the deploy notifier up to our Slack webhook.",
		);
		// 5 passed of 7 graded (errored run excluded from graded denominator) -> 71%
		expect(creds?.passed).toBe(5);
		expect(creds?.graded).toBe(7);
		expect(creds?.passRate).toBe(71);
		expect(creds?.failing).toBe(true);
		expect(creds?.causes).toEqual(["skill", "harness"]);
		expect(creds?.failures).toHaveLength(2);
		expect(creds?.failures[0]?.runNumbers).toEqual([2, 3]);
		expect(creds?.failures[1]?.runNumbers).toEqual([2]);

		expect(prefs?.sentence).toBe(
			"asks product preferences in one questions card",
		);
		expect(prefs?.passRate).toBe(100);
		expect(prefs?.failing).toBe(false);
		expect(prefs?.causes).toEqual([]);

		// A spec's own rule replaces the default: 1 failure allowed in its window.
		const lenient = scenarios.map((each) =>
			each.id === "creds/webhook"
				? { ...each, pass: { need: 1, of: 9 } }
				: each,
		);
		expect(summarizeTests(grid, lenient)[0]?.failing).toBe(false);

		expect(remediesSummary(tests)).toBe("1 fix proposed");
		expect(doneAsideText(grid)).toBe("3 models × 3 runs · $9.40");
	});
});

describe("buildFailureTimeline", () => {
	it("builds a short step timeline with Expected and Got on the failing step", () => {
		const detail: EvalDetail = {
			id: "batch-1#r2",
			status: "fail",
			tokens: 500,
			costUsd: 0.1,
			milliseconds: 38000,
			producer: "splates",
			scenario: "creds/webhook",
			aspect: "creds",
			requirement: "reads creds.md before asking for a secret",
			target: SONNET,
			repetition: 3,
			input: "Hook the deploy notifier up to our Slack webhook.",
			rubric: null,
			checks: [
				{
					id: "asks-through-creds",
					about: "ask with splates creds ask, never in chat",
					pass: false,
				},
			],
			judge: null,
			reply: "Paste the Slack webhook URL here.",
			transcript: [
				{
					kind: "tool",
					name: "Read",
					input: JSON.stringify({ file_path: "SKILL.md" }),
					output: "",
					milliseconds: 3000,
				},
				{
					kind: "tool",
					name: "Grep",
					input: JSON.stringify({ pattern: "SLACK_WEBHOOK" }),
					output: "",
					milliseconds: 6000,
				},
			],
		};
		const failure: EvalFailure = {
			kind: "diagnosed",
			runs: ["batch-1#r2"],
			check: "asks-through-creds",
			causes: ["skill"],
			why: "The creds trigger names tokens but not webhook URLs.",
			did: { text: "asked in chat", step: null },
			remedy: {
				text: "name webhook URLs in the creds trigger",
				state: "proposed",
			},
		};

		const steps = buildFailureTimeline(detail, failure);
		expect(steps.map(({ key: _, ...rest }) => rest)).toEqual([
			{ label: "Read SKILL.md", elapsed: "0:03", failed: false },
			{ label: "Grep SLACK_WEBHOOK", elapsed: "0:09", failed: false },
			{
				label: "Replied: “Paste the Slack webhook URL here.”",
				elapsed: "0:38",
				failed: true,
				expected: "ask with splates creds ask, never in chat",
				got: "asked in chat",
			},
		]);
	});
});

const SONNET: EvalTarget = {
	key: "claude/claude-sonnet-4-5",
	agent: "claude",
	model: "claude-sonnet-4-5",
	effort: null,
	skill: null,
};

const KIMI: EvalTarget = {
	key: "kimi",
	agent: "kimi",
	model: null,
	effort: null,
	skill: null,
};

const ANTIGRAVITY: EvalTarget = {
	key: "antigravity/gemini-3-pro",
	agent: "antigravity",
	model: "gemini-3-pro",
	effort: null,
	skill: null,
};

function cell(
	scenario: string,
	target: string,
	repetition: number,
	status: "pass" | "fail" | "error",
	id: string,
) {
	return {
		scenario,
		aspect: "",
		requirement: "",
		target,
		repetition,
		run: {
			id: `batch-1#${id}`,
			status,
			tokens: 100,
			costUsd: 0.1,
			milliseconds: 1000,
		},
	};
}
