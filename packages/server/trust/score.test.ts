import { describe, expect, it } from "bun:test";
import { classifyQuestion } from "./classify";
import {
	conversationDecisions,
	outcomeWeights,
	scoreDecisions,
	summarizeTrust,
} from "./score";
import type { TrustDecision, TrustSetting } from "./types";

function makeDecision(
	overrides: Partial<TrustDecision> & {
		at: string;
		outcome: TrustDecision["outcome"];
	},
): TrustDecision {
	return {
		id: `d-${overrides.at}-${Math.random()}`,
		project: "/repo",
		agent: "claude",
		model: "Opus 4.6",
		kind: "design",
		source: "question",
		subject: "Choice?",
		conversation: "c1",
		task: "t1",
		...overrides,
	};
}

describe("trust scoring", () => {
	it("weighs every outcome in whole numbers, with amended leaving trust alone", () => {
		const sources = [
			"question",
			"mockup",
			"plan",
			"unasked",
			"redo",
			"revert",
		] as const;
		const weights = sources.map((source) => ({
			source,
			kept: outcomeWeights({ source, outcome: "kept" }),
			amended: outcomeWeights({ source, outcome: "amended" }),
			overturned: outcomeWeights({ source, outcome: "overturned" }),
		}));
		const kept = { alpha: 1, beta: 0 };
		const amended = { alpha: 0, beta: 0 };
		expect(weights).toEqual([
			{ source: "question", kept, amended, overturned: { alpha: 0, beta: 2 } },
			{ source: "mockup", kept, amended, overturned: { alpha: 0, beta: 2 } },
			{ source: "plan", kept, amended, overturned: { alpha: 0, beta: 2 } },
			{ source: "unasked", kept, amended, overturned: { alpha: 0, beta: 3 } },
			{ source: "redo", kept, amended, overturned: { alpha: 0, beta: 3 } },
			{ source: "revert", kept, amended, overturned: { alpha: 0, beta: 3 } },
		]);
	});

	it("leaves the score alone on an amended decision but still counts it", () => {
		const kept = [
			{
				at: "2026-11-01T00:00:00Z",
				source: "question" as const,
				outcome: "kept" as const,
			},
		];
		const amended = {
			at: "2026-11-02T00:00:00Z",
			source: "plan" as const,
			outcome: "amended" as const,
		};
		expect(scoreDecisions([...kept, amended])).toBe(scoreDecisions(kept));
		const [entry] = summarizeTrust(
			[
				makeDecision({ at: "2026-11-01T00:00:00Z", outcome: "kept" }),
				makeDecision({
					at: "2026-11-02T00:00:00Z",
					outcome: "amended",
					source: "plan",
				}),
			],
			[],
		);
		expect(entry?.counts).toEqual({
			kept: 1,
			amended: 1,
			overturned: 0,
			total: 2,
		});
	});

	it("starts neutral at 50 with zero decisions and does not jump to 100 or ask-and-go after 3 of 3 kept", () => {
		const empty = scoreDecisions([]);
		expect(empty).toBe(50);

		const threeKept = scoreDecisions([
			{ at: "2026-11-01T00:00:00Z", source: "question", outcome: "kept" },
			{ at: "2026-11-02T00:00:00Z", source: "question", outcome: "kept" },
			{ at: "2026-11-03T00:00:00Z", source: "question", outcome: "kept" },
		]);
		expect(threeKept).toBeGreaterThan(empty);
		expect(threeKept).toBeLessThan(70);
	});

	it("starts from a manually set base and moves dynamically with later decisions", () => {
		expect(scoreDecisions([], 75)).toBe(75);
		expect(scoreDecisions([], 0)).toBe(0);
		expect(scoreDecisions([], 100)).toBe(100);

		const afterKept = scoreDecisions(
			[{ at: "2026-11-01T00:00:00Z", source: "question", outcome: "kept" }],
			75,
		);
		const afterOverturned = scoreDecisions(
			[
				{
					at: "2026-11-01T00:00:00Z",
					source: "question",
					outcome: "overturned",
				},
			],
			75,
		);
		expect(afterKept).toBeGreaterThan(75);
		expect(afterOverturned).toBeLessThan(75);
	});

	it("climbs toward high trust over ~30 kept decisions", () => {
		const many = Array.from({ length: 30 }, (_, i) => ({
			at: `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
			source: "question" as const,
			outcome: "kept" as const,
		}));
		const score = scoreDecisions(many);
		expect(score).toBeGreaterThanOrEqual(75);
		expect(score).toBeLessThanOrEqual(95);
	});

	it("weighs overturns of unasked picks, redo removals, and reverts more heavily than question or plan overturns, which weigh the same", () => {
		const base = Array.from({ length: 10 }, (_, i) => ({
			at: `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
			source: "question" as const,
			outcome: "kept" as const,
		}));
		const withQuestionOverturn = scoreDecisions([
			...base,
			{ at: "2026-11-15T00:00:00Z", source: "question", outcome: "overturned" },
		]);
		const withPlanOverturn = scoreDecisions([
			...base,
			{ at: "2026-11-15T00:00:00Z", source: "plan", outcome: "overturned" },
		]);
		const withRedoOverturn = scoreDecisions([
			...base,
			{ at: "2026-11-15T00:00:00Z", source: "redo", outcome: "overturned" },
		]);
		const withRevertOverturn = scoreDecisions([
			...base,
			{ at: "2026-11-15T00:00:00Z", source: "revert", outcome: "overturned" },
		]);
		expect(withQuestionOverturn).toBe(withPlanOverturn);
		expect(withPlanOverturn).toBeGreaterThan(withRedoOverturn);
		expect(withRedoOverturn).toBe(withRevertOverturn);
	});

	it("weights recent decisions more strongly than old ones", () => {
		const oldOverturnsThenKept = [
			...Array.from({ length: 10 }, (_, i) => ({
				at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
				source: "question" as const,
				outcome: "overturned" as const,
			})),
			...Array.from({ length: 20 }, (_, i) => ({
				at: `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
				source: "question" as const,
				outcome: "kept" as const,
			})),
		];
		const oldKeptThenOverturns = [
			...Array.from({ length: 20 }, (_, i) => ({
				at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
				source: "question" as const,
				outcome: "kept" as const,
			})),
			...Array.from({ length: 10 }, (_, i) => ({
				at: `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
				source: "question" as const,
				outcome: "overturned" as const,
			})),
		];
		expect(scoreDecisions(oldOverturnsThenKept)).toBeGreaterThan(
			scoreDecisions(oldKeptThenOverturns) + 15,
		);
	});

	it("respects static overrides and resetAt in summarizeTrust", () => {
		const decisions: TrustDecision[] = [
			makeDecision({
				at: "2026-11-01T00:00:00Z",
				outcome: "overturned",
				source: "redo",
			}),
			makeDecision({
				at: "2026-11-10T00:00:00Z",
				outcome: "kept",
				kind: "visual",
				source: "mockup",
			}),
			makeDecision({
				at: "2026-11-11T00:00:00Z",
				outcome: "kept",
				kind: "approval",
				source: "plan",
			}),
		];
		const settings: TrustSetting[] = [
			{
				project: "/repo",
				agent: "claude",
				model: "Opus 4.6",
				mode: "static",
				value: 80,
				resetAt: "2026-11-05T00:00:00Z",
				updatedAt: "2026-11-12T00:00:00Z",
			},
		];
		const [entry] = summarizeTrust(decisions, settings);
		expect(entry).toBeDefined();
		expect(entry?.score).toBe(80);
		expect(entry?.mode).toBe("static");
		expect(entry?.counts.total).toBe(2);
		expect(entry?.counts.overturned).toBe(0);
		expect(entry?.dynamicScore).toBeGreaterThan(50);
		const visual = entry?.kinds.find((k) => k.kind === "visual");
		expect(visual?.counts.kept).toBe(1);
	});

	it("anchors dynamic scoring at a manual base while keeping decision counts", () => {
		const decisions: TrustDecision[] = [
			makeDecision({ at: "2026-11-01T00:00:00Z", outcome: "overturned" }),
			makeDecision({ at: "2026-11-10T00:00:00Z", outcome: "kept" }),
		];
		const settings: TrustSetting[] = [
			{
				project: "/repo",
				agent: "claude",
				model: "Opus 4.6",
				mode: "dynamic",
				value: 50,
				dynamicBase: 80,
				dynamicAt: "2026-11-05T00:00:00Z",
				resetAt: null,
				updatedAt: "2026-11-05T00:00:00Z",
			},
		];
		const [entry] = summarizeTrust(decisions, settings);
		expect(entry?.mode).toBe("dynamic");
		expect(entry?.counts.total).toBe(2);
		expect(entry?.score).toBe(scoreDecisions(decisions.slice(1), 80));
		expect(entry?.score).toBeGreaterThan(80);

		const { decisions: scored } = conversationDecisions(
			decisions,
			settings,
			"c1",
		);
		expect(scored[1]?.after).toBe(entry?.score);
		expect(scored[1]?.delta).toBe((entry?.score ?? 0) - 80);
	});
});

describe("conversationDecisions", () => {
	it("gives each of a conversation's decisions its score change, after others' decisions", () => {
		const decisions = [
			makeDecision({
				at: "2026-01-01T00:00:00Z",
				outcome: "kept",
				conversation: "other",
			}),
			makeDecision({ at: "2026-01-02T00:00:00Z", outcome: "kept" }),
			makeDecision({
				at: "2026-01-03T00:00:00Z",
				outcome: "kept",
				conversation: "other",
			}),
			makeDecision({ at: "2026-01-04T00:00:00Z", outcome: "overturned" }),
		];
		const { decisions: mine, net } = conversationDecisions(decisions, [], "c1");
		expect(mine.map((each) => each.at)).toEqual([
			"2026-01-02T00:00:00Z",
			"2026-01-04T00:00:00Z",
		]);
		const one = scoreDecisions(decisions.slice(0, 1));
		const two = scoreDecisions(decisions.slice(0, 2));
		const three = scoreDecisions(decisions.slice(0, 3));
		const four = scoreDecisions(decisions);
		expect(mine[0]?.delta).toBe(two - one);
		expect(mine[1]?.delta).toBe(four - three);
		expect(mine[1]?.after).toBe(four);
		expect(mine[0]?.delta).toBeGreaterThan(0);
		expect(mine[1]?.delta).toBeLessThan(0);
		expect(net).toBe(two - one + four - three);
	});

	it("leaves out decisions from before the model's reset", () => {
		const decisions = [
			makeDecision({ at: "2026-01-01T00:00:00Z", outcome: "kept" }),
			makeDecision({ at: "2026-01-05T00:00:00Z", outcome: "kept" }),
		];
		const setting: TrustSetting = {
			project: "/repo",
			agent: "claude",
			model: "Opus 4.6",
			mode: "dynamic",
			value: 50,
			resetAt: "2026-01-03T00:00:00Z",
			updatedAt: "2026-01-03T00:00:00Z",
		};
		const { decisions: mine } = conversationDecisions(
			decisions,
			[setting],
			"c1",
		);
		expect(mine).toHaveLength(1);
		expect(mine[0]?.delta).toBe(
			scoreDecisions(decisions.slice(1)) - scoreDecisions([]),
		);
	});
});

describe("classifyQuestion", () => {
	it("always classifies questions with images as visual", () => {
		expect(
			classifyQuestion({
				text: "Which retry timeout should we use?",
				body: "![shot](/abs/path.png)",
				choices: [],
			}),
		).toBe("visual");
		expect(
			classifyQuestion({
				text: "Pick a default",
				body: "",
				choices: [
					{
						key: "a",
						text: "Option A",
						body: "![a](/a.png)",
						why: "",
						chosen: true,
					},
				],
			}),
		).toBe("visual");
	});

	it("classifies plan approvals as approval", () => {
		expect(
			classifyQuestion(
				{ text: "Do you approve adding the table?", body: "", choices: [] },
				{ approval: true },
			),
		).toBe("approval");
	});

	it("classifies defaults, scope, visual, and design by wording", () => {
		expect(
			classifyQuestion({
				text: "What retry limit should the worker use?",
				body: "",
				choices: [],
			}),
		).toBe("defaults");
		expect(
			classifyQuestion({
				text: "Should we split this into two tasks?",
				body: "",
				choices: [],
			}),
		).toBe("scope");
		expect(
			classifyQuestion({
				text: "Which button color fits the card header?",
				body: "",
				choices: [],
			}),
		).toBe("visual");
		expect(
			classifyQuestion({
				text: "Should the endpoint accept JSON or form data?",
				body: "",
				choices: [],
			}),
		).toBe("design");
	});
});
