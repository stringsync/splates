import { describe, expect, test } from "bun:test";
import { filtersOnClick } from "./tag-chips";

describe("filtersOnClick", () => {
	test("a plain click does not narrow the board", () => {
		expect(filtersOnClick({ metaKey: false, ctrlKey: false })).toBe(false);
	});

	test("a command or control click does", () => {
		expect(filtersOnClick({ metaKey: true, ctrlKey: false })).toBe(true);
		expect(filtersOnClick({ metaKey: false, ctrlKey: true })).toBe(true);
	});
});
