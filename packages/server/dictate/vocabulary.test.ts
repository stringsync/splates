import { describe, expect, it } from "bun:test";
import { MAX_WORDS, vocabulary, words } from "./vocabulary";

describe("vocabulary", () => {
	it("lists splates and the project once", () => {
		expect(words("webappwiz")).toEqual(["splates", "webappwiz"]);
		expect(words("splates")).toEqual(["splates"]);
	});
	it("adds the project's words, then the person's, each once", () => {
		expect(words("app", ["scry", "splates"], ["Pulumi", "scry"])).toEqual([
			"splates",
			"app",
			"scry",
			"Pulumi",
		]);
	});
	it("keeps splates and the project however long the lists", () => {
		const many = Array.from({ length: 80 }, (_, at) => `word${at}`);
		const listed = words("app", many);
		expect(listed).toHaveLength(MAX_WORDS);
		expect(listed.slice(0, 2)).toEqual(["splates", "app"]);
	});
	it("hints the spelling of what it lists", () => {
		expect(vocabulary(["splates", "webappwiz"])).toBe(
			"A developer dictating a prompt for a coding agent. Words that may come up: splates, webappwiz.",
		);
	});
});
