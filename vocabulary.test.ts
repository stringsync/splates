import { describe, expect, it } from "bun:test";
import { vocabulary, words } from "./vocabulary";

describe("vocabulary", () => {
	it("lists each word once: arbor, the project, then every system and alias", () => {
		expect(
			words("webappwiz", {
				arbor: { aliases: ["todos"], globs: [] },
				scry: { globs: [] },
			}),
		).toEqual(["arbor", "webappwiz", "todos", "scry"]);
	});

	it("names every system and alias after arbor and the project", () => {
		expect(
			vocabulary("webappwiz", {
				board: { aliases: ["todos", "lanes"], globs: [] },
				scry: { globs: [] },
			}),
		).toBe(
			"A developer dictating a prompt for a coding agent. Words that may come up: arbor, webappwiz, board, todos, lanes, scry.",
		);
	});
});
