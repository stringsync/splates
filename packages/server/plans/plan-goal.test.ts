import { describe, expect, it } from "bun:test";
import { goalLine } from "./plan";

const GOOD = `# alpha

## Goal
Teach show to check the plan.

## Next
- [x] wrote the checker
- [ ] wire it up

## Notes
- lives in plan.ts
`;

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
