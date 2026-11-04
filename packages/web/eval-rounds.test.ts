import { expect, test } from "bun:test";
import { evalRoundsOf, layerCounts } from "./eval-rounds";

const REPORT = `Passes now.

| Round | Label | Change | Current | Baseline | Why | Files |
| ----- | ----- | ------ | ------- | -------- | --- | ----- |
| 1 | skill | Claim before reading | 1/3 | 0/3 | Too faint | SKILL.md |
| 2 | judge | Rubric accepts scoped runs | 3/3 | 1/3 | | focused.ts |

Stopped by: the scenario passes every repetition.`;

test("reads rounds, layers and rates, and leaves the other words", () => {
	const read = evalRoundsOf(REPORT);

	expect(read?.rounds).toHaveLength(2);
	expect(read?.rounds[0]).toMatchObject({
		layer: "skill",
		current: { passed: 1, of: 3 },
		why: "Too faint",
		files: "SKILL.md",
	});
	expect(read?.stoppedBy).toBe("the scenario passes every repetition.");
	expect(read?.rest).toBe("Passes now.");
	expect(layerCounts(read?.rounds ?? [])).toBe("1 skill · 1 judge");
});

test("reads nothing from a report without a rounds table", () => {
	expect(evalRoundsOf("Both merged tasks kept their tests.")).toBeNull();
});
