import { expect, test } from "bun:test";
import { improvable, improvePrompt, scenarioPrompt } from "./eval-improve";

test("improvePrompt is a directive naming the run, with the default limits as text", () => {
	expect(improvePrompt({ id: "batch-a#run-000" })).toBe(
		"[SPLATES EVAL LOOP batch-a#run-000]\nBudget: $10\nRounds: 3",
	);
});

test("improvePrompt carries the chosen budget and rounds", () => {
	expect(improvePrompt({ id: "b#r" }, { usd: 2.5, rounds: 5 })).toBe(
		"[SPLATES EVAL LOOP b#r]\nBudget: $2.5\nRounds: 5",
	);
});

test("only a failing run is improvable", () => {
	expect(improvable("fail")).toBe(true);
	expect(improvable("error")).toBe(false);
	expect(improvable("pass")).toBe(false);
});

test("scenarioPrompt names a scenario, with limits and no agents line by default", () => {
	expect(scenarioPrompt("resources/focused-tests")).toBe(
		"[SPLATES EVAL LOOP scenario resources/focused-tests]\nBudget: $10\nRounds: 3",
	);
});

test("scenarioPrompt lists the picked agents", () => {
	expect(
		scenarioPrompt("a/b", { usd: 2, rounds: 1 }, ["x:m@high", "y:n@low"]),
	).toBe(
		"[SPLATES EVAL LOOP scenario a/b]\nBudget: $2\nRounds: 1\nAgents: `x:m@high`, `y:n@low`",
	);
});

test("scenarioPrompt ends with the repetitions when asked", () => {
	expect(scenarioPrompt("a/b", { usd: 2, rounds: 1 }, [], 5)).toBe(
		"[SPLATES EVAL LOOP scenario a/b]\nBudget: $2\nRounds: 1\nRepetitions: 5",
	);
});
