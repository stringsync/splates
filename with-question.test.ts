import { describe, expect, it } from "bun:test";
import { questions, withQuestion } from "./plan";

describe("withQuestion", () => {
	it("numbers a new question after the rest, its detail indented under it", () => {
		const added = withQuestion(
			BLOCKED,
			"Ready to merge?",
			"Look at\nthe header.",
		);
		expect(added.number).toBe("5");
		expect(questions(added.plan).at(-1)).toMatchObject({
			number: "5",
			text: "Ready to merge?",
			body: "Look at\nthe header.",
		});
		expect(questions(added.plan)).toHaveLength(questions(BLOCKED).length + 1);
	});

	it("makes ## Blocked when there is none", () => {
		const added = withQuestion(GOOD, "Ready to merge?");
		expect(added).toEqual({
			plan: `${GOOD.trimEnd()}\n\n## Blocked\n\n- [ ] 1. Ready to merge?\n`,
			number: "1",
		});
	});
});

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

const BLOCKED = `${GOOD}
## Blocked

- [x] 1. Run the tests. Does it fit? → pass
- [ ] 2. Does the header fit? → no, too wide
- [ ] 3. Decide: keep or drop?
  - not a question of its own
- [ ] 4. Confirm the copy.
`;
