import { describe, expect, it } from "bun:test";
import { ready, unfinished, whatIsLeft } from "./plan";

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
