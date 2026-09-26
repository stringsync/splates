import { describe, expect, it } from "bun:test";
import { checkPlan } from "./plan";

const GOOD = `# alpha

## Goal
Teach show to check the plan.

## Files
- plan.ts

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
		expect(problems).toEqual([
			"no ## Goal section",
			"no ## Files section",
			"no ## Next section",
		]);
	});

	it("wants the files the task plans to touch", () => {
		const problems = checkPlan(GOOD.replace("- plan.ts", ""), {
			task: "alpha",
		});
		expect(problems).toEqual([
			"## Files is empty: list the file paths you plan to touch",
		]);
	});

	it("wants a next step, not just an empty heading", () => {
		const problems = checkPlan(GOOD.replace("- [ ] wire it up", ""), {
			task: "alpha",
		});
		expect(problems).toEqual([
			"## Next has no `- [ ]` item: say what the next step is",
		]);
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
			"escalated with no ## Blocked section: add `- [ ] Q1.` items for what the reviewer must do",
		]);
		const vague = `${GOOD}\n## Blocked\nIs the new banner the right green?\n`;
		expect(checkPlan(vague, { task: "alpha", escalated: true })).toEqual([
			"## Blocked lists nothing: add `- [ ] Q1.` items for what the reviewer must do",
		]);
		const asked = `${GOOD}\n## Blocked\n- [ ] Q1. Open /tmp/shot.png. Confirm the banner is green.\n`;
		expect(checkPlan(asked, { task: "alpha", escalated: true })).toEqual([]);
	});

	it("flags open items once the task is no longer escalated", () => {
		const items =
			"- [x] Q1. Run the tests. → pass\n- [ ] Q2. Decide: keep or drop?\n- [ ] Q3. Open /tmp/a.png.\n";
		const blocked = `${GOOD}\n## Blocked\n${items}`;
		expect(checkPlan(blocked, { task: "alpha" })).toEqual([
			"## Blocked has open Q2, Q3: ask the reviewer before merging",
		]);
		const answered = `${GOOD}\n## Blocked\n${items.replaceAll("- [ ]", "- [x]")}`;
		expect(checkPlan(answered, { task: "alpha" })).toEqual([]);
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
