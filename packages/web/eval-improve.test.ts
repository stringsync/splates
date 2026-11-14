import { expect, test } from "bun:test";
import {
	byNamespace,
	improvable,
	improvePrompt,
	scenarioPrompt,
} from "./eval-improve";

test("improvePrompt is a directive naming the run, with no budget", () => {
	expect(improvePrompt({ id: "batch-a#run-000" })).toBe(
		"[SPLATES EVAL LOOP batch-a#run-000]",
	);
});

test("only a failing run is improvable", () => {
	expect(improvable("fail")).toBe(true);
	expect(improvable("error")).toBe(false);
	expect(improvable("pass")).toBe(false);
});

test("scenarioPrompt names a scenario, with no agents line by default", () => {
	expect(scenarioPrompt("resources/focused-tests")).toBe(
		"[SPLATES EVAL LOOP scenario resources/focused-tests]",
	);
});

test("scenarioPrompt lists the picked agents", () => {
	expect(scenarioPrompt("a/b", ["x:m@high", "y:n@low"])).toBe(
		"[SPLATES EVAL LOOP scenario a/b]\nAgents: `x:m@high`, `y:n@low`",
	);
});

test("scenarioPrompt ends with the repetitions when asked", () => {
	expect(scenarioPrompt("a/b", [], 5)).toBe(
		"[SPLATES EVAL LOOP scenario a/b]\nRepetitions: 5",
	);
});

test("scenarioPrompt names several scenarios in one directive", () => {
	expect(scenarioPrompt(["a/b", "a/c"])).toBe(
		"[SPLATES EVAL LOOP scenarios a/b a/c]",
	);
});

test("byNamespace groups ids by the path before the last slash", () => {
	expect(byNamespace(["a/x", "b/y", "a/z"])).toEqual([["a/x", "a/z"], ["b/y"]]);
});
