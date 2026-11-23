import { expect, it } from "bun:test";
import { rulesTarget, rulesTaskText } from "./rules-task";
import type { ScorecardRow } from "./scorecard";

it("reads lifts as the judge's, holdout lifts as keeping the lineup, the rest as up or down a step", () => {
	expect(rulesTarget(row({ verdict: "weak", signals: ["lifts"] }))).toBe(
		"judge",
	);
	expect(
		rulesTarget(
			row({ verdict: "weak", signals: ["lifts"], liftedInHoldout: true }),
		),
	).toBe("keep");
	expect(rulesTarget(row({ verdict: "weak", signals: ["trouble"] }))).toBe(
		"up",
	);
	expect(rulesTarget(row({ verdict: "strong", signals: ["cost"] }))).toBe(
		"down",
	);
	expect(rulesTarget(row({ verdict: "strong", signals: ["holdout"] }))).toBe(
		"easier",
	);
	expect(rulesTarget(row({}))).toBeNull();
	expect(rulesTarget(row({ verdict: "sparse" }))).toBeNull();
});

it("writes nothing when no cell is flagged", () => {
	expect(
		rulesTaskText({
			rows: [row({}), row({ verdict: "sparse", tasks: 3 })],
			overrides: [],
			minimumTasks: 10,
		}),
	).toBeNull();
});

it("lists each flagged cell's numbers, what it points at and its overrides, and leaves sparse cells alone", () => {
	const text = rulesTaskText({
		rows: [
			row({
				depth: "shallow",
				lineup: "quick",
				verdict: "weak",
				signals: ["lifts", "overrides"],
				lifts: 4,
				overridesUp: 3,
				overridesDown: 1,
				troubleRate: 0.4,
				suggestion: "Recheck Shallow depth criteria",
			}),
			row({
				kind: "design",
				lineup: "careful",
				verdict: "strong",
				signals: ["cost"],
				dollarsPerTask: 4,
				comparison: { cost: 4, nextCost: 2, ratio: 2 },
				suggestion: "Test the Thoughtful lineup",
			}),
			row({ verdict: "fine" }),
			row({ kind: "open", depth: "moderate", verdict: "sparse", tasks: 3 }),
		],
		overrides: [
			{
				kind: "bugfix",
				depth: "shallow",
				count: 4,
				earlier: 1,
				moves: [
					{
						from: { model: "Sonnet 5.5", effort: "low" },
						to: { model: "Opus 5.5", effort: "high" },
						count: 3,
					},
				],
			},
		],
		minimumTasks: 10,
	});
	expect(text).toContain(
		"- Bugfix · Shallow, quick lineup: 12 tasks, $1.50/task, trouble 40%, corrections 5%, 4 lifts, overrides 3 up, 1 down",
	);
	expect(text).toContain("It points at the judge");
	expect(text).toContain(
		"The scorecard suggests: Recheck Shallow depth criteria.",
	);
	expect(text).toContain("moved Sonnet 5.5 · low to Opus 5.5 · high, 3 times");
	expect(text).toContain("1 earlier overrides, with no pairing recorded");
	expect(text).toContain("2.0× the next pick down ($4.00 against $2.00)");
	expect(text).toContain("down-step holdout");
	expect(text).toContain("change nothing until the user approves");
	expect(text).toContain(
		"Leave alone the cells with fewer than 10 tasks, too few to judge: Open-ended · Moderate, careful lineup (3).",
	);
	expect(text).not.toContain("Bugfix · Deep");
});

function row(overrides: Partial<ScorecardRow>): ScorecardRow {
	return {
		kind: "bugfix",
		depth: "deep",
		lineup: "careful",
		tasks: 12,
		dollarsPerTask: 1.5,
		turns: 2,
		lines: 40,
		troubleRate: 0.1,
		correctionRate: 0.05,
		liftRate: 0,
		lifts: 0,
		liftedInHoldout: false,
		troubledWithoutLift: 0,
		overridesUp: 0,
		overridesDown: 0,
		overridesUnranked: 0,
		verdict: "fine",
		signals: [],
		comparison: null,
		holdout: null,
		suggestion: null,
		...overrides,
	};
}
