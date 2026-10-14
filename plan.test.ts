import { describe, expect, it } from "bun:test";
import {
	assumptions,
	checkPlan,
	goalLine,
	questions,
	ready,
	unfinished,
	whatIsLeft,
} from "./plan";

const GOOD = `# alpha

## Goal
Teach show to check the plan.

## Done
- [x] wrote the checker

## Next
- [ ] wire it up

## Notes
- lives in plan.ts
`;

describe("checkPlan", () => {
	it("passes a plan in the prescribed shape", () => {
		expect(checkPlan(GOOD, { task: "alpha" })).toEqual([]);
	});

	it("wants the title to name the task", () => {
		expect(
			checkPlan(GOOD.replace("# alpha", "# Alpha work"), { task: "alpha" }),
		).toEqual(['title is "# Alpha work", should be "# alpha"']);
	});

	it("names the required sections that are missing", () => {
		const problems = checkPlan("# alpha\n", { task: "alpha" });
		expect(problems).toEqual(["no ## Goal section", "no ## Next section"]);
	});

	it("takes a Next with nothing left as a finished task", () => {
		const finished = GOOD.replace("- [ ] wire it up", "- [x] wire it up");
		expect(checkPlan(finished, { task: "alpha" })).toEqual([]);
	});

	it("catches work parked under Done that is not done", () => {
		const problems = checkPlan(GOOD.replace("- [x] wrote", "- [ ] wrote"), {
			task: "alpha",
		});
		expect(problems).toEqual([
			"## Done has a `- [ ]` item: it belongs under ## Next",
		]);
	});

	it("wants an escalation to leave numbered items behind", () => {
		expect(checkPlan(GOOD, { task: "alpha", escalated: true })).toEqual([
			"escalated with no ## Blocked section: add `- [ ] 1.` items for what the reviewer must do",
		]);
		const vague = `${GOOD}\n## Blocked\nIs the new banner the right green?\n`;
		expect(checkPlan(vague, { task: "alpha", escalated: true })).toEqual([
			"## Blocked lists nothing: add `- [ ] 1.` items for what the reviewer must do",
		]);
		const asked = `${GOOD}\n## Blocked\n- [ ] 1. Open /tmp/shot.png. Confirm the banner is green.\n`;
		expect(checkPlan(asked, { task: "alpha", escalated: true })).toEqual([]);
		const detailed = `${GOOD}\n## Blocked\n- [ ] 1. Does the banner fit?\n  ![banner](/tmp/shot.png)\n  - (a) Yes\n`;
		expect(checkPlan(detailed, { task: "alpha", escalated: true })).toEqual([]);
	});

	it("wants no question from a review, which asks only to approve", () => {
		expect(
			checkPlan(GOOD, { task: "alpha", escalated: true, review: true }),
		).toEqual([]);
	});

	it("flags open items once the task is no longer escalated", () => {
		const items =
			"- [x] 1. Run the tests. → pass\n- [ ] 2. Decide: keep or drop?\n- [ ] 3. Open /tmp/a.png.\n";
		const blocked = `${GOOD}\n## Blocked\n${items}`;
		expect(checkPlan(blocked, { task: "alpha" })).toEqual([
			"## Blocked has open questions 2, 3: ask the reviewer before merging",
		]);
		const answered = `${GOOD}\n## Blocked\n${items.replaceAll("- [ ]", "- [x]")}`;
		expect(checkPlan(answered, { task: "alpha" })).toEqual([]);
		// Answered but unchecked is the agent's to act on, not the reviewer's.
		const acting = `${GOOD}\n## Blocked\n- [ ] 1. Keep it? → yes\n  → and rename it\n`;
		expect(checkPlan(acting, { task: "alpha" })).toEqual([]);
	});

	it("flags a section nobody will think to read", () => {
		const problems = checkPlan(`${GOOD}\n## Ideas\n- someday\n`, {
			task: "alpha",
		});
		expect(problems[0]).toContain('unexpected section "## Ideas"');
	});

	it("does not mistake a comment in a fenced block for a heading", () => {
		const fenced = `${GOOD}\n\`\`\`bash\n# alpha notes\n## Goal\n\`\`\`\n`;
		expect(checkPlan(fenced, { task: "alpha" })).toEqual([]);
	});
});

describe("unfinished", () => {
	it("finds the unchecked questions and steps a merge waits on", () => {
		const plan = `${GOOD}\n## Blocked\n- [x] 1. Keep it? → yes\n- [ ] 2. Rename it?\n- [ ] 3. Drop it? → yes\n`;
		const left = unfinished(plan);
		expect(left).toEqual({ questions: ["2", "3"], steps: ["wire it up"] });
		expect(ready(left)).toBe(false);
		expect(whatIsLeft(left)).toBe(
			"questions 2, 3 unchecked under ## Blocked and 1 step unchecked under ## Next",
		);
	});

	it("leaves nothing once every box is checked, or with no plan at all", () => {
		const finished = GOOD.replace("- [ ] wire it up", "- [x] wire it up");
		expect(ready(unfinished(finished))).toBe(true);
		expect(ready(unfinished(""))).toBe(true);
	});

	it("ignores an unchecked box outside Next and Blocked", () => {
		const noted = `${GOOD.replace("- [ ] wire it up", "")}\n- [ ] an aside\n`;
		expect(unfinished(noted).steps).toEqual([]);
	});
});

const ASSUMED = `${GOOD.replace("- [ ] wire it up", "- [x] wire it up")}
## Assumptions

- [ ] 1. What should the flag be called?
  - (a) \`--dry-run\` (chosen)
  - (b) \`--preview\`

## Blocked

- [x] 2. Should it run by default? → b
  - (a) Yes
  - (b) No (chosen)
`;

describe("assumptions", () => {
	it("reads the calls made without asking, apart from the questions", () => {
		expect(assumptions(ASSUMED)).toMatchObject([
			{
				number: "1",
				text: "What should the flag be called?",
				choices: [
					{ key: "a", text: "`--dry-run`", chosen: true },
					{ key: "b", text: "`--preview`", chosen: false },
				],
			},
		]);
		expect(questions(ASSUMED).map((asked) => asked.number)).toEqual(["2"]);
	});

	it("leaves a task ready to merge with its assumptions unchallenged", () => {
		expect(ready(unfinished(ASSUMED))).toBe(true);
		expect(checkPlan(ASSUMED, { task: "alpha" })).toEqual([]);
	});

	it("wants each one to mark the choice it took", () => {
		const unmarked = ASSUMED.replace(
			" (chosen)\n  - (b) `--preview`",
			"\n  - (b) `--preview`",
		);
		expect(checkPlan(unmarked, { task: "alpha" })).toEqual([
			"## Assumptions item 1 marks no choice `(chosen)`: offer what else it could have been, and mark the one taken",
		]);
	});

	it("catches a number used in both sections", () => {
		const copied = ASSUMED.replace("- [x] 2.", "- [x] 1.");
		expect(checkPlan(copied, { task: "alpha" })).toEqual([
			"1 numbered twice across ## Assumptions and ## Blocked: a challenged assumption moves to ## Blocked rather than being copied, and new items continue from the highest",
		]);
	});
});

describe("goalLine", () => {
	it("takes the first line under ## Goal", () => {
		expect(goalLine(GOOD)).toBe("Teach show to check the plan.");
		expect(goalLine("# alpha\n\n## Goal\n\n\n  dark mode\ncharts\n")).toBe(
			"dark mode",
		);
	});

	it("is null for a plan that has no Goal yet", () => {
		expect(goalLine("# alpha\n")).toBeNull();
		expect(goalLine("# alpha\n\n## Goal\n\n## Next\n")).toBeNull();
	});
});
