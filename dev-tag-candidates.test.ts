import { describe, expect, it } from "bun:test";
import { candidates } from "./dev-tag-systems";
import { SYSTEMS } from "./dev-tag-systems-testing";

describe("candidates", () => {
	const phrases = (text: string) =>
		candidates(text, SYSTEMS).map(({ phrase, systems }) => [phrase, systems]);

	it("finds names and aliases, whatever their case", () => {
		expect(phrases("Run Scry on the board's todos.")).toEqual([
			["Scry", ["scry"]],
			["board", ["board"]],
			["todos", ["board"]],
		]);
	});

	it("takes a several-word alias over the one word inside it", () => {
		expect(phrases("Open the conversation view")).toEqual([
			["conversation view", ["conversations"]],
		]);
	});

	it("finds a name heard apart, or a letter off on a long word", () => {
		expect(phrases("the check point and the checkpiont")).toEqual([
			["check point", ["checkpoint"]],
			["checkpiont", ["checkpoint"]],
		]);
	});

	it("leaves a word that is already a mention or a path", () => {
		expect(phrases("#scry and @scry and /scry")).toEqual([]);
	});

	it("takes words heard apart only when they keep every letter", () => {
		expect(phrases("I cry")).toEqual([["cry", ["scry"]]]);
		expect(phrases("the check pint")).toEqual([]);
	});

	it("leaves a word inside a code span or a fenced block", () => {
		expect(phrases("the `scry-ignore` and `scry` marker")).toEqual([]);
		expect(phrases("```\nscry here\n```\nthen scry")).toEqual([
			["scry", ["scry"]],
		]);
	});

	it("leaves a name that is only part of a hyphenated word", () => {
		expect(phrases("a scry-ignore comment, not scry")).toEqual([
			["scry", ["scry"]],
		]);
		expect(phrases("the pre-scry step")).toEqual([]);
	});
});
