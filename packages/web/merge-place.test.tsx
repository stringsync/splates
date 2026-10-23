import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { MergePlace, placeInLine } from "./merge-place";
import { cleanup, render } from "./testing-library";

afterEach(cleanup);

describe("MergePlace", () => {
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

	it("shows a queued merge's place, and nothing for a merge testing or whose place is unknown", () => {
		const shown = (need: Parameters<typeof MergePlace>[0]["need"]) =>
			render(<MergePlace need={need} />).container.textContent;
		expect(
			shown({ kind: "working", subject: null, merge: "queued", mergePlace: 2 }),
		).toBe("2nd in line");
		expect(
			shown({
				kind: "working",
				subject: null,
				merge: "running",
				mergePlace: 1,
			}),
		).toBe("");
		expect(shown({ kind: "working", subject: null, merge: "queued" })).toBe("");
	});
});
