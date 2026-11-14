import { expect, test } from "bun:test";
import { withoutLoopParameters } from "./directives.tsx";

const LOOP = "[SPLATES EVAL LOOP scenario a/b]";

test("an eval loop's parameter lines leave the shown words", () => {
	const rest = "Budget: $5\nAgents: `x`\nRepetitions: 3\nRun it.";
	expect(withoutLoopParameters([LOOP], rest)).toBe("Run it.");
	expect(withoutLoopParameters([LOOP], "Agents: `x`")).toBe("");
});

test("other directives keep their words", () => {
	expect(withoutLoopParameters(["[SPLATES MERGE]"], "Budget: 1")).toBe(
		"Budget: 1",
	);
});
