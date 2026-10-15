import { describe, expect, it } from "bun:test";
import type { DictatedTake } from "webappwiz/dictate";
import { TakeReview } from "./take-review";

/** "run #scry now, so go": a tag made, and a filler "so," only suggested. */
const take: DictatedTake = {
	text: "run #scry now, so go",
	said: "run s cry now, so go",
	applied: [{ type: "tag", start: 4, end: 9, was: "s cry" }],
	edits: [{ type: "filler", start: 13, end: 17, text: "", probability: 0.5 }],
	decisions: [],
};

describe("TakeReview", () => {
	it("starts with the sure edits made and the suggestions left", () => {
		const review = TakeReview.of(take);

		expect(review?.text()).toBe("run #scry now, so go");
		expect(review?.isCleaned).toBe(true);
		expect(review?.marks.map((mark) => [mark.kind, mark.suggested])).toEqual([
			["tag", false],
			["filler", true],
		]);
	});

	it("undoes a made edit and makes a suggested one, each with a flip", () => {
		const review = TakeReview.of(take)?.toggled(0).toggled(1);

		expect(review?.text()).toBe("run s cry now go");
		expect(review?.isCleaned).toBe(false);
		expect(review?.toggled(0).toggled(1).text()).toBe("run #scry now, so go");
	});

	it("goes back to the words as said, and to the cleaned text", () => {
		const review = TakeReview.of(take);

		expect(review?.undoneAll().text()).toBe("run s cry now, so go");
		expect(review?.undoneAll().isAsSaid).toBe(true);
		expect(review?.undoneAll().asCleaned().text()).toBe(review?.text());
	});

	it("drops an edit over words another one already covers", () => {
		const review = TakeReview.of({
			...take,
			edits: [
				{ type: "tag", start: 4, end: 9, system: "scry", probability: 0.4 },
			],
		});

		expect(review?.marks).toHaveLength(1);
	});

	it("is nothing when no edit was made or suggested", () => {
		expect(TakeReview.of({ ...take, applied: [], edits: [] })).toBeUndefined();
	});
});
