import { describe, expect, it } from "bun:test";
import {
	checkPlan,
	plannedFiles,
	type Question,
	questionNumber,
	questions,
	replyLine,
	withFollowUp,
	withQuestion,
	withReply,
} from "./plan";

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
		const detailed = `${GOOD}\n## Blocked\n- [ ] Q1. 🎨 Does the banner fit?\n  ![banner](/tmp/shot.png)\n  - (a) Yes\n`;
		expect(checkPlan(detailed, { task: "alpha", escalated: true })).toEqual([]);
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
		// Answered but unchecked is the agent's to act on, not the reviewer's.
		const acting = `${GOOD}\n## Blocked\n- [ ] Q1. Keep it? → yes\n  → and rename it\n`;
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

describe("plannedFiles", () => {
	it("takes each top-level bullet under ## Files, without backticks", () => {
		const plan = [
			"# alpha",
			"",
			"## Files",
			"",
			"Phase 1:",
			"",
			"- `a.ts`",
			"- b/{c,d}.ts",
			"  - nested note",
			"",
			"## Next",
			"",
			"- [ ] not a file",
		].join("\n");

		expect(plannedFiles(plan)).toEqual(["a.ts", "b/{c,d}.ts"]);
	});

	it("plans nothing without a ## Files section", () => {
		expect(plannedFiles("# alpha\n")).toEqual([]);
	});
});

const BLOCKED = `${GOOD}
## Blocked

- [x] Q1. Run the tests. Does it fit? → pass
- [ ] Q2. 🎨 Does the header fit? → no, too wide
- [ ] Q3. Decide: keep or drop?
  - not a question of its own
- [ ] Q4. Confirm the copy.
`;

/** A question as `questions` reads it, with nothing under it. */
function bare(overrides: Partial<Question>): Question {
	return {
		number: "Q1",
		done: false,
		text: "",
		body: "",
		reply: null,
		followUps: [],
		choices: [],
		pick: null,
		chosen: [],
		images: [],
		...overrides,
	};
}

describe("questions", () => {
	it("reads each numbered item with its reply and what is indented under it", () => {
		expect(questions(BLOCKED)).toEqual([
			bare({
				number: "Q1",
				done: true,
				text: "Run the tests. Does it fit?",
				reply: "pass",
			}),
			bare({
				number: "Q2",
				text: "🎨 Does the header fit?",
				reply: "no, too wide",
			}),
			bare({
				number: "Q3",
				text: "Decide: keep or drop?",
				body: "- not a question of its own",
			}),
			bare({ number: "Q4", text: "Confirm the copy." }),
		]);
	});

	it("reads only ## Blocked", () => {
		const elsewhere = GOOD.replace(
			"- [ ] wire it up",
			"- [ ] Q1. Not blocked.",
		);
		expect(questions(elsewhere)).toEqual([]);
		const after = `${BLOCKED}\n## Notes\n- [ ] Q9. Also not blocked.\n`;
		expect(questions(after).map((found) => found.number)).toEqual([
			"Q1",
			"Q2",
			"Q3",
			"Q4",
		]);
	});

	it("keeps the body's markdown, code and images included", () => {
		const plan = `${GOOD}
## Blocked

- [ ] Q1. 🗄️ Does this migration look right?
  It runs before the deploy.

  \`\`\`sql
  alter table users
    add column email text;
  \`\`\`

  ![before](/tmp/before.png) ![after](/tmp/after.png)
  - (a) Ship it
Prose back at the margin ends it.
  - (b) not a choice of Q1
`;
		expect(questions(plan)).toEqual([
			bare({
				text: "🗄️ Does this migration look right?",
				body: [
					"It runs before the deploy.",
					"",
					"```sql",
					"alter table users",
					"  add column email text;",
					"```",
					"",
					"![before](/tmp/before.png) ![after](/tmp/after.png)",
				].join("\n"),
				choices: [{ key: "a", text: "Ship it" }],
				pick: "one",
				images: ["/tmp/before.png", "/tmp/after.png"],
			}),
		]);
	});
});

const CHOICES = `${GOOD}
## Blocked

- [ ] Q1. How do old sessions move over?
  - (a) Force everyone to sign in again
  - (b) Migrate on next login
- [ ] Q2. Which table? → b (users): and backfill
  - (a) sessions
  - (b) users
- [ ] Q3. Anything else? → a bit more logging
- [ ] Q4. Pick one → c
  - (a) left
- [ ] Q5. Where should it notify? → c (Push), a: and log it
  - [a] Email
  - [b] Slack
  - [c] Push
`;

describe("choices", () => {
	it("reads the choices indented under each question", () => {
		const [first, second, third, fourth, fifth] = questions(CHOICES);
		expect(first).toMatchObject({
			choices: [
				{ key: "a", text: "Force everyone to sign in again" },
				{ key: "b", text: "Migrate on next login" },
			],
			pick: "one",
			chosen: [],
		});
		expect(second?.chosen).toEqual(["b"]);
		// Words that happen to start with a letter pick nothing.
		expect(third).toMatchObject({ choices: [], pick: null, chosen: [] });
		// Nor does a letter it never offered.
		expect(fourth?.chosen).toEqual([]);
		// Picks from a `[a]` list, bare or spelled out, in the order offered.
		expect(fifth).toMatchObject({ pick: "any", chosen: ["a", "c"] });
	});

	it("spells each pick out in the reply, words after them", () => {
		const [asked, , , , any] = questions(CHOICES);
		if (asked === undefined || any === undefined) {
			throw new Error("no question");
		}
		expect(replyLine(asked, { choices: ["b"], text: "" })).toBe(
			"b (Migrate on next login)",
		);
		expect(replyLine(asked, { choices: ["a"], text: " email them " })).toBe(
			"a (Force everyone to sign in again): email them",
		);
		expect(replyLine(asked, { text: "neither, ask Sam" })).toBe(
			"neither, ask Sam",
		);
		expect(replyLine(any, { choices: ["c", "a"], text: "" })).toBe(
			"a (Email), c (Push)",
		);
	});

	it("keeps the choices when the question is answered", () => {
		const replied = withReply(CHOICES, "Q1", "b (Migrate on next login)");
		expect(replied).toContain(
			"sessions move over? → b (Migrate on next login)\n  - (a) Force",
		);
		expect(questions(replied ?? "")[0]?.chosen).toEqual(["b"]);
	});
});

describe("withReply", () => {
	it("writes the reply after the arrow, leaving the checkbox open", () => {
		const replied = withReply(BLOCKED, "Q3", "keep");
		expect(replied).toContain("- [ ] Q3. Decide: keep or drop? → keep\n");
		expect(replied?.replace(" → keep", "")).toBe(BLOCKED);
	});

	it("replaces an earlier reply and keeps the answer on one line", () => {
		const replied = withReply(BLOCKED, "Q2", "pass\nnow it fits");
		expect(replied).toContain(
			"- [ ] Q2. 🎨 Does the header fit? → pass now it fits\n",
		);
		expect(replied).not.toContain("too wide");
	});

	it("finds nothing to answer outside ## Blocked", () => {
		expect(withReply(BLOCKED, "Q9", "yes")).toBeNull();
		expect(withReply(GOOD, "Q1", "yes")).toBeNull();
	});
});

describe("withFollowUp", () => {
	it("adds a line under everything the question has, and unchecks it", () => {
		const plan =
			"## Blocked\n\n- [x] Q1. Keep it? → yes\n  It is old.\n  - (a) Yes\n\n- [ ] Q2. Next?\n";
		expect(withFollowUp(plan, "Q1", "and rename\nit")).toBe(
			"## Blocked\n\n- [ ] Q1. Keep it? → yes\n  It is old.\n  - (a) Yes\n  → and rename it\n\n- [ ] Q2. Next?\n",
		);
		expect(withFollowUp(plan, "Q9", "x")).toBeNull();
	});
});

describe("withQuestion", () => {
	it("numbers a new question after the rest, its detail indented under it", () => {
		const added = withQuestion(
			BLOCKED,
			"✅ Ready to merge?",
			"Look at\nthe header.",
		);
		expect(added.number).toBe("Q5");
		expect(questions(added.plan).at(-1)).toMatchObject({
			number: "Q5",
			text: "✅ Ready to merge?",
			body: "Look at\nthe header.",
		});
		expect(questions(added.plan)).toHaveLength(questions(BLOCKED).length + 1);
	});

	it("makes ## Blocked when there is none", () => {
		const added = withQuestion(GOOD, "✅ Ready to merge?");
		expect(added).toEqual({
			plan: `${GOOD.trimEnd()}\n\n## Blocked\n\n- [ ] Q1. ✅ Ready to merge?\n`,
			number: "Q1",
		});
	});
});

describe("questionNumber", () => {
	it("reads a number however it was typed", () => {
		for (const raw of ["Q9", "q9", "9", "Q9.", " q9: "]) {
			expect(questionNumber(raw)).toBe("Q9");
		}
		expect(questionNumber("nine")).toBeNull();
		expect(questionNumber("D9")).toBeNull();
	});
});
