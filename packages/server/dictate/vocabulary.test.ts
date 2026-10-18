import { describe, expect, it } from "bun:test";
import { vocabulary, words } from "./vocabulary";

describe("vocabulary", () => {
	it("lists splates and the project once", () => {
		expect(words("webappwiz")).toEqual(["splates", "webappwiz"]);
		expect(words("splates")).toEqual(["splates"]);
	});
	it("hints the project spelling", () => {
		expect(vocabulary("webappwiz")).toBe(
			"A developer dictating a prompt for a coding agent. Words that may come up: splates, webappwiz.",
		);
	});
});
