import { expect, test } from "bun:test";
import { parseScenarioList } from "./scenario-list";

test("keeps definitions before a run and tolerates older frameworks", () => {
	const definition = {
		prompt: "Do it",
		checks: [{ id: "a", about: "Asks first" }],
		judge: "Explain why",
	};
	expect(
		parseScenarioList(JSON.stringify({ case: "a", ...definition }))[0],
	).toMatchObject(definition);
	expect(parseScenarioList('{"case":"old"}')).toEqual([
		{ id: "old", group: null, about: null },
	]);
	expect(
		parseScenarioList('{"case":"bad","prompt":7,"checks":[null,{"id":3}]}')[0]
			?.checks,
	).toEqual([]);
});

test("keeps a spec's sentence and its describe groups", () => {
	const [spec] = parseScenarioList(
		JSON.stringify({
			case: "splates/creds",
			sentence: "reads creds.md before asking for a secret",
			groups: ["splates skill", "context budget"],
		}),
	);
	expect(spec?.sentence).toBe("reads creds.md before asking for a secret");
	expect(spec?.groups).toEqual(["splates skill", "context budget"]);
	expect(
		parseScenarioList('{"case":"a","sentence":"","groups":["x",3]}')[0],
	).toEqual({ id: "a", group: null, about: null });
});

test("keeps a spec's own pass rule when it is a need of a window", () => {
	const rule = (value: unknown) =>
		parseScenarioList(JSON.stringify({ case: "a", pass: value }))[0]?.pass;
	expect(rule({ need: 1, of: 2 })).toEqual({ need: 1, of: 2 });
	expect(rule({ need: 3, of: 2 })).toBeUndefined();
	expect(rule(0.5)).toBeUndefined();
});

test("keeps the file a spec is listed from, when it names one", () => {
	const file = (value: unknown) =>
		parseScenarioList(JSON.stringify({ case: "a", file: value }))[0]?.file;
	expect(file("skills/splates/evals/core-loop.ts")).toBe(
		"skills/splates/evals/core-loop.ts",
	);
	expect(file("")).toBeUndefined();
	expect(file(3)).toBeUndefined();
});

test("keeps a spec's environment and the steps of its example reply", () => {
	const [spec] = parseScenarioList(
		JSON.stringify({
			case: "a",
			environment: "A repo with `users.ts`",
			example: [
				{ kind: "tool", name: "Bash", input: "splates add x", does: "Starts" },
				{ kind: "tool", name: "Read" },
				{ kind: "text", text: "Plan" },
				{ kind: "tool" },
				7,
			],
		}),
	);
	expect(spec?.environment).toBe("A repo with `users.ts`");
	expect(spec?.example).toEqual([
		{ kind: "tool", name: "Bash", input: "splates add x", does: "Starts" },
		{ kind: "tool", name: "Read", input: "", does: null },
		{ kind: "text", text: "Plan" },
	]);
	expect(
		parseScenarioList('{"case":"a","environment":"","example":[]}')[0],
	).toEqual({ id: "a", group: null, about: null });
});

test("keeps a spec's priority when it is high, normal, or low", () => {
	const priority = (value: unknown) =>
		parseScenarioList(JSON.stringify({ case: "a", priority: value }))[0]
			?.priority;
	expect(priority("high")).toBe("high");
	expect(priority("normal")).toBe("normal");
	expect(priority("low")).toBe("low");
	expect(priority("urgent")).toBeUndefined();
	expect(priority(1)).toBeUndefined();
	expect(priority(undefined)).toBeUndefined();
});
