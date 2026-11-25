import { expect, test } from "bun:test";
import type { Scenario } from "../scenario";
import { definitionOf } from "./list-entry";

const base: Scenario = {
	id: "a/b",
	aspect: "a",
	requirement: "r",
	message: "do it",
};

test("definition carries prompt, check ids and abouts, and judge", () => {
	const out = definitionOf({
		...base,
		judge: "did it",
		checks: [{ id: "c", about: "is c", test: () => true }],
	});
	expect(out).toEqual({
		prompt: "do it",
		checks: [{ id: "c", about: "is c" }],
		judge: "did it",
	});
	expect(JSON.stringify(out)).not.toContain("test");
});

test("no checks or judge gives an empty list and no judge", () => {
	expect(definitionOf(base)).toEqual({ prompt: "do it", checks: [] });
});

test("environment and example are carried when set", () => {
	const example = [
		{ kind: "tool", name: "Bash", input: "splates add x", does: "Starts it" },
		{ kind: "text", text: "done" },
	] as const;
	expect(definitionOf({ ...base, environment: "A repo", example })).toEqual({
		prompt: "do it",
		checks: [],
		environment: "A repo",
		example,
	});
});

test("priority is carried when set", () => {
	expect(definitionOf({ ...base, priority: "high" })).toEqual({
		prompt: "do it",
		checks: [],
		priority: "high",
	});
});
