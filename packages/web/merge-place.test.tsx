import { describe, expect, it } from "bun:test";
import { placeInLine } from "./merge-place";

describe("placeInLine", () => {
	it("says next for the first place, and the ordinal after it", () => {
		expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(placeInLine)).toEqual([
			"next",
			"2nd in line",
			"3rd in line",
			"4th in line",
			"11th in line",
			"12th in line",
			"13th in line",
			"21st in line",
			"22nd in line",
		]);
	});
});
