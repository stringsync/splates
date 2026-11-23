import { expect, it } from "bun:test";
import { DEFAULT_RULES } from "../auto-pick/browser";
import { DEFAULT_AGENTS } from "../models";
import type { Event } from "../records";
import {
	improvementsKey,
	improvementsTaskText,
	overpoweredLineups,
} from "./improvements";
import type { Outcome, OutcomeAutoPick } from "./outcomes";
import { scorecard, scorecardWindow } from "./scorecard";

it("distinguishes lifts, trouble without a lift and override directions in the same cell", () => {
	const override = {
		kind: PICK.kind,
		depth: PICK.depth,
		at: "2026-11-23T05:00:00Z",
		aspect: "model" as const,
		to: "opus",
		from: { model: "Sonnet 5.5", effort: "Low" },
		result: { model: "Opus 5.5", effort: "High" },
	};
	const quick = Array.from({ length: 10 }, (_, index) =>
		task(
			index,
			{
				...(index < 4 ? { findings: [{ kind: "retried", times: 1 }] } : {}),
				...(index < 2 ? { overrides: [override] } : {}),
			},
			{
				lifts:
					index < 4
						? [
								{
									from: PICK,
									to: { ...PICK, effort: "high" },
									at: "2026-11-23T04:00:00Z",
								},
							]
						: [],
			},
		),
	);
	const standard = Array.from({ length: 10 }, (_, index) =>
		task(
			index + 10,
			index < 3 ? { ended: "removed", removedFor: "redo" } : {},
			{ lineup: "standard" },
		),
	);
	const sparse = task(20, {}, { lineup: "old-lineup" });
	const rows = scorecard([...quick, ...standard, sparse], {
		agents: DEFAULT_AGENTS,
	});
	expect(rows).toMatchObject([
		{
			lineup: "quick",
			tasks: 10,
			verdict: "weak",
			signals: ["lifts", "overrides"],
			troubleRate: 0.4,
			liftRate: 0.4,
			overridesUp: 2,
			lines: 10,
			lifts: 4,
			suggestion: "Recheck Shallow depth criteria",
		},
		{
			lineup: "standard",
			tasks: 10,
			verdict: "weak",
			signals: ["trouble"],
			troubledWithoutLift: 3,
			liftRate: 0,
			suggestion: "Try the Careful lineup",
		},
		{
			lineup: "old-lineup",
			tasks: 1,
			verdict: "sparse",
			signals: [],
			suggestion: null,
		},
	]);
});

it("flags expensive clean picks only with judged corrections and an observed next pick down", () => {
	const deep = Array.from({ length: 10 }, (_, index) =>
		task(
			index,
			{
				usage: {
					input: 100,
					cached: 0,
					output: 10,
					cost: { amount: 2.2, currency: "USD" },
				},
			},
			{
				kind: "design",
				depth: "deep",
				lineup: "careful",
				model: "opus",
				effort: "high",
			},
		),
	);
	const lower = Array.from({ length: 10 }, (_, index) =>
		task(
			index + 10,
			{},
			{ kind: "design", depth: "deep", lineup: "thoughtful", effort: "high" },
		),
	);
	const events = new Map([
		[
			"/example",
			deep.flatMap((outcome) => [
				correction(outcome, 0.05),
				correction(outcome, 1, "2026-11-23T09:00:00Z"),
			]),
		],
	]);
	const rows = scorecard([...deep, ...lower], {
		agents: DEFAULT_AGENTS,
		eventsByProject: events,
	});
	expect(rows[0]).toMatchObject({
		lineup: "careful",
		verdict: "strong",
		signals: ["cost"],
		comparison: { nextCost: 1 },
		suggestion: "Test the Thoughtful lineup",
	});
	expect(rows[0]?.comparison?.ratio).toBeCloseTo(2.2);
	expect(rows[0]?.correctionRate).toBeCloseTo(0.05);
	expect(
		scorecard(deep, { agents: DEFAULT_AGENTS, eventsByProject: events })[0],
	).toMatchObject({
		verdict: "fine",
		suggestion: null,
	});
	expect(
		scorecard([...deep, ...lower], {
			agents: DEFAULT_AGENTS,
			eventsByProject: events,
			rules: null,
		})[0],
	).toMatchObject({
		suggestion: "Test Sonnet 5.5 at high effort for this cell",
		suggestionProvider: "anthropic",
	});
	expect(
		scorecard([...deep, ...lower], { agents: DEFAULT_AGENTS })[0]?.verdict,
	).toBe("fine");
});

it("keeps the ordinary lineup when frequent lifts came from a step-down trial", () => {
	const pick = { ...PICK, depth: "moderate" };
	const trials = Array.from({ length: 10 }, (_, index) =>
		task(
			index,
			{},
			{
				...pick,
				holdout: {
					holdout: true,
					version: "holdout-1",
					lineup: "standard",
					from: "Sonnet 5.5, medium effort",
				},
				lifts:
					index < 4
						? [
								{
									from: pick,
									to: { ...pick, lineup: "standard", effort: "medium" },
									at: "2026-11-23T04:00:00Z",
								},
							]
						: [],
			},
		),
	);
	expect(scorecard(trials, { agents: DEFAULT_AGENTS })[0]).toMatchObject({
		verdict: "weak",
		suggestion: "Keep the Standard lineup",
	});
});

it("calls a lineup overpowered when its cell's held-out tasks did as well", () => {
	const cell = { ...PICK, depth: "moderate", lineup: "standard" };
	const regular = Array.from({ length: 10 }, (_, index) =>
		task(
			index,
			index < 1 ? { findings: [{ kind: "retried", times: 1 }] } : {},
			{
				...cell,
			},
		),
	);
	const held = (count: number, troubled: number) =>
		Array.from({ length: count }, (_, index) =>
			task(
				100 + index,
				index < troubled ? { findings: [{ kind: "retried", times: 1 }] } : {},
				{
					...cell,
					lineup: "quick",
					holdout: {
						holdout: true,
						version: "holdout-1",
						lineup: "standard",
						from: "Sonnet 5.5, medium effort",
					},
				},
			),
		);
	const standard = (rows: ReturnType<typeof scorecard>) =>
		rows.find((row) => row.lineup === "standard");

	// 15% held out against 10% regular is within five points.
	const rows = scorecard([...regular, ...held(20, 3)], {
		agents: DEFAULT_AGENTS,
	});
	expect(standard(rows)).toMatchObject({
		tasks: 10,
		verdict: "strong",
		signals: ["holdout"],
		suggestion: "Try the Quick lineup",
		holdout: {
			easier: "quick",
			heldOut: { tasks: 20, problems: 3, problemRate: 0.15 },
			regular: { tasks: 10, problems: 1, problemRate: 0.1 },
			overpowered: true,
		},
	});
	expect(overpoweredLineups(rows)).toMatchObject([
		{ lineup: "standard", cells: [{ kind: "bugfix", depth: "moderate" }] },
	]);
	expect(improvementsKey(overpoweredLineups(rows))).toBe(
		JSON.stringify(["standard:bugfix.moderate"]),
	);
	expect(
		improvementsTaskText(overpoweredLineups(rows), DEFAULT_RULES),
	).toContain(
		"  - Bugfix · Moderate: held out on Quick, 20 tasks, 15% problems, $1.00 a task; regular 10 tasks, 10% problems, $1.00 a task",
	);

	// Worse by more than five points, or too few held out, is no call.
	const worse = standard(
		scorecard([...regular, ...held(10, 2)], { agents: DEFAULT_AGENTS }),
	);
	expect(worse?.holdout?.overpowered).toBe(false);
	expect(worse?.verdict).toBe("fine");
	const few = standard(
		scorecard([...regular, ...held(9, 0)], { agents: DEFAULT_AGENTS }),
	);
	expect(few?.holdout).toMatchObject({
		heldOut: { tasks: 9 },
		overpowered: false,
	});
	expect(improvementsTaskText([], DEFAULT_RULES)).toBeNull();
});

it("filters by the task's end and keeps legacy outcomes available for override history", () => {
	const current = task(0);
	const old = task(1, { endedAt: "2026-11-18T00:00:00Z" });
	const future = task(2, { endedAt: "2026-11-24T00:00:00Z" });
	const { autoPick: _, ...legacy } = task(3);
	expect(scorecardWindow([current, old, future, legacy], "1d", NOW)).toEqual({
		history: [current, legacy],
		picks: [current],
	});
	expect(scorecardWindow([current, old, future, legacy], "all", NOW)).toEqual({
		history: [current, old, legacy],
		picks: [current, old],
	});
});

const NOW = Date.parse("2026-11-23T12:00:00Z");
const PICK: OutcomeAutoPick = {
	kind: "bugfix",
	depth: "shallow",
	lineup: "quick",
	agent: "claude",
	model: "sonnet",
	effort: "low",
	lifts: [],
};

function task(
	index: number,
	data: Partial<Outcome> = {},
	pick: Partial<OutcomeAutoPick> = {},
): Outcome & { autoPick: OutcomeAutoPick } {
	return {
		task: `task-${index}`,
		project: "/example",
		base: "main",
		ended: "merged",
		startedAt: "2026-11-23T00:00:00Z",
		endedAt: "2026-11-23T08:00:00Z",
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		conversation: `conversation-${index}`,
		agent: "claude",
		model: "sonnet",
		findings: [],
		turns: 2,
		size: { files: 1, added: 8, removed: 2 },
		usage: {
			input: 100,
			cached: 0,
			output: 10,
			cost: { amount: 1, currency: "USD" },
		},
		...data,
		autoPick: { ...PICK, ...pick },
	};
}

function correction(
	outcome: Outcome,
	corrects: number,
	at = "2026-11-23T03:00:00Z",
): Event {
	return {
		id: `${outcome.task}-${at}`,
		at,
		action: "notes attached",
		reason: null,
		conversation: outcome.conversation,
		task: outcome.task,
		afterReply: true,
		notes: [],
		holdout: false,
		ms: 1,
		corrects,
	};
}
