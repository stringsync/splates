import { describe, expect, it } from "bun:test";
import { vocabulary, words } from "./vocabulary";

describe("vocabulary", () => {
	it("lists each word once: splates, the project, then every system and alias", () => {
		expect(
			words("webappwiz", {
				splates: { aliases: ["todos"], globs: [] },
				scry: { globs: [] },
			}),
		).toEqual(["splates", "webappwiz", "todos", "scry"]);
	});

	it("names every system and alias after splates and the project", () => {
		expect(
			vocabulary("webappwiz", {
				board: { aliases: ["todos", "lanes"], globs: [] },
				scry: { globs: [] },
			}),
		).toBe(
			"A developer dictating a prompt for a coding agent. Words that may come up: splates, webappwiz, board, todos, lanes, scry.",
		);
	});
});
