import { describe, expect, it } from "bun:test";
import { checkPlan } from "./plan";

const GOOD = `# alpha

## Goal
Teach show to check the plan.

## Next
- [x] wrote the checker
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

	it("names the required sections that are missing, which steps are not", () => {
		const problems = checkPlan("# alpha\n", { task: "alpha" });
		expect(problems).toEqual(["no ## Goal section"]);
	});

	it("takes a Next with nothing left as a finished task", () => {
		const finished = GOOD.replace("- [ ] wire it up", "- [x] wire it up");
		expect(checkPlan(finished, { task: "alpha" })).toEqual([]);
	});

	it("flags a ## Done left from before the git log kept steps done", () => {
		const old = GOOD.replace("## Next", "## Done\n- [x] wrote it\n\n## Next");
		expect(checkPlan(old, { task: "alpha" })).toEqual([
			'unexpected section "## Done" (line 6): keep to Goal, Next, Notes, Blocked',
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

	it("catches a number used twice under Blocked", () => {
		const copied = `${GOOD}
## Blocked

- [x] 1. Should it run by default? → b
  - (a) Yes
  - (b) No (chosen)
- [ ] 1. What should the flag be called?
`;
		expect(checkPlan(copied, { task: "alpha" })).toContain(
			"1 numbered twice under ## Blocked: new questions continue from the highest",
		);
	});
});
