import { describe, expect, it } from "bun:test";
import { checkTodo } from "./todo";

const GOOD = `# alpha

## Goal
Teach show to check the TODO.

## Done
- [x] wrote the checker

## Next
- [ ] wire it up

## Notes
- lives in lib/todo.ts
`;

describe("checkTodo", () => {
	it("passes a TODO in the prescribed shape", () => {
		expect(checkTodo(GOOD, { task: "alpha" })).toEqual([]);
	});

	it("wants the title to name the task", () => {
		expect(
			checkTodo(GOOD.replace("# alpha", "# Alpha work"), { task: "alpha" }),
		).toEqual(['title is "# Alpha work", should be "# alpha"']);
	});

	it("names the required sections that are missing", () => {
		const problems = checkTodo("# alpha\n", { task: "alpha" });
		expect(problems).toEqual(["no ## Goal section", "no ## Next section"]);
	});

	it("wants a next step, not just an empty heading", () => {
		const problems = checkTodo(GOOD.replace("- [ ] wire it up", ""), {
			task: "alpha",
		});
		expect(problems).toEqual([
			"## Next has no `- [ ]` item: say what the next step is",
		]);
	});

	it("catches work parked under Done that is not done", () => {
		const problems = checkTodo(GOOD.replace("- [x] wrote", "- [ ] wrote"), {
			task: "alpha",
		});
		expect(problems).toEqual([
			"## Done has a `- [ ]` item: it belongs under ## Next",
		]);
	});

	it("wants an escalation to leave a question behind", () => {
		expect(checkTodo(GOOD, { task: "alpha", escalated: true })).toEqual([
			"escalated with no ## Blocked section: state what needs verifying and the question a human must answer",
		]);
		const vague = `${GOOD}\n## Blocked\nThe colours look wrong.\n`;
		expect(checkTodo(vague, { task: "alpha", escalated: true })).toEqual([
			"## Blocked asks nothing: a human needs one specific question to answer",
		]);
		const asked = `${GOOD}\n## Blocked\nIs the new banner the right green?\n`;
		expect(checkTodo(asked, { task: "alpha", escalated: true })).toEqual([]);
	});

	it("flags a section nobody will think to read", () => {
		const problems = checkTodo(`${GOOD}\n## Ideas\n- someday\n`, {
			task: "alpha",
		});
		expect(problems[0]).toContain('unexpected section "## Ideas"');
	});

	it("does not mistake a comment in a fenced block for a heading", () => {
		const fenced = `${GOOD}\n\`\`\`bash\n# alpha notes\n## Goal\n\`\`\`\n`;
		expect(checkTodo(fenced, { task: "alpha" })).toEqual([]);
	});
});
