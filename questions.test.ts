import { describe, expect, it } from "bun:test";
import { type Question, questions } from "./plan";

describe("questions", () => {
	it("still reads a plan numbered the old way, Q1", () => {
		const [asked] = questions("## Blocked\n\n- [ ] Q3. Keep it? → yes\n");

		expect(asked).toMatchObject({
			number: "3",
			text: "Keep it?",
			reply: "yes",
		});
	});

	it("reads each numbered item with its reply and what is indented under it", () => {
		expect(questions(BLOCKED)).toEqual([
			bare({
				number: "1",
				done: true,
				text: "Run the tests. Does it fit?",
				reply: "pass",
			}),
			bare({
				number: "2",
				text: "Does the header fit?",
				reply: "no, too wide",
			}),
			bare({
				number: "3",
				text: "Decide: keep or drop?",
				body: "- not a question of its own",
			}),
			bare({ number: "4", text: "Confirm the copy." }),
		]);
	});

	it("reads only ## Blocked", () => {
		const elsewhere = GOOD.replace("- [ ] wire it up", "- [ ] 1. Not blocked.");
		expect(questions(elsewhere)).toEqual([]);
		const after = `${BLOCKED}\n## Notes\n- [ ] 9. Also not blocked.\n`;
		expect(questions(after).map((found) => found.number)).toEqual([
			"1",
			"2",
			"3",
			"4",
		]);
	});

	it("keeps the body's markdown, code and images included", () => {
		const plan = `${GOOD}
## Blocked

- [ ] 1. Does this migration look right?
  It runs before the deploy.

  \`\`\`sql
  alter table users
    add column email text;
  \`\`\`

  ![before](/tmp/before.png) ![after](/tmp/after.png)
  - (a) Ship it
Prose back at the margin ends it.
  - (b) not a choice of 1
`;
		expect(questions(plan)).toEqual([
			bare({
				text: "Does this migration look right?",
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
				choices: [
					{ key: "a", text: "Ship it", body: "", why: "", chosen: false },
				],
				pick: "one",
			}),
		]);
	});

	it("reads the choices indented under each question", () => {
		const [first, second, third, fourth, fifth] = questions(CHOICES);
		expect(first).toMatchObject({
			choices: [
				{ key: "a", text: "Force everyone to sign in again", chosen: false },
				{ key: "b", text: "Migrate on next login", chosen: true },
			],
			pick: "one",
		});
		expect(second?.choices.map((choice) => choice.key)).toEqual(["a", "b"]);
		expect(third).toMatchObject({ choices: [], pick: null });
		expect(fourth?.pick).toBe("one");
		expect(fifth).toMatchObject({ pick: "any" });
	});

	it("reads the lines indented under a choice as that choice's", () => {
		const [asked] = questions(`${GOOD}
## Blocked

- [ ] 1. Which style should the action list take?
  The current one:
  ![current](/tmp/current.png)
  - (a) A rail (chosen)
    ![rail](/tmp/rail.png)
    Quietest of the two.
  - (b) A panel
    ![panel](/tmp/panel.png)
  Dark ones are attached too.
`);
		expect(asked).toMatchObject({
			body: [
				"The current one:",
				"![current](/tmp/current.png)",
				"Dark ones are attached too.",
			].join("\n"),
			choices: [
				{
					key: "a",
					text: "A rail",
					body: "![rail](/tmp/rail.png)\nQuietest of the two.",
					chosen: true,
				},
				{ key: "b", text: "A panel", body: "![panel](/tmp/panel.png)" },
			],
		});
	});

	it("reads a choice's `Why:` line apart from its body", () => {
		const [asked] = questions(`${GOOD}
## Blocked

- [ ] 1. How should existing sessions move to the new tokens?
  - (a) Sign everyone out once
    ![signed out](/tmp/out.png)
    why: simplest, and nothing to keep.
    Dark one too: ![dark](/tmp/dark.png)
  - (b) Migrate each session on its next request (chosen)
    Why: no one gets signed out.
`);
		expect(asked?.choices).toMatchObject([
			{
				key: "a",
				body: "![signed out](/tmp/out.png)\nDark one too: ![dark](/tmp/dark.png)",
				why: "simplest, and nothing to keep.",
			},
			{ key: "b", body: "", why: "no one gets signed out.", chosen: true },
		]);
	});

	it("reads `- a.` choices as ones a reply puts in order", () => {
		const [asked] = questions(`${GOOD}
## Blocked

- [ ] 1. In what order should these land?
  - a. The schema
  - b. The API (chosen)
`);
		expect(asked).toMatchObject({
			choices: [
				{ key: "a", text: "The schema", chosen: false },
				{ key: "b", text: "The API", chosen: true },
			],
			pick: "order",
		});
	});
});

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

const BLOCKED = `${GOOD}
## Blocked

- [x] 1. Run the tests. Does it fit? → pass
- [ ] 2. Does the header fit? → no, too wide
- [ ] 3. Decide: keep or drop?
  - not a question of its own
- [ ] 4. Confirm the copy.
`;

const CHOICES = `${GOOD}
## Blocked

- [ ] 1. How do old sessions move over?
  - (a) Force everyone to sign in again
  - (b) Migrate on next login (chosen)
- [ ] 2. Which table? → b (users): and backfill
  - (a) sessions
  - (b) users
- [ ] 3. Anything else? → a bit more logging
- [ ] 4. Pick one → c
  - (a) left
- [ ] 5. Where should it notify? → c (Push), a: and log it
  - [a] Email
  - [b] Slack
  - [c] Push
`;

/** A question as `questions` reads it, with nothing under it. */
function bare(overrides: Partial<Question>): Question {
	return {
		number: "1",
		done: false,
		text: "",
		body: "",
		reply: null,
		followUps: [],
		choices: [],
		pick: null,
		...overrides,
	};
}
