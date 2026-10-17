import { describe, expect, it } from "bun:test";
import { tierFor } from "./auto-pick";

describe("tierFor", () => {
	const tier = (answers: Record<string, number>) =>
		tierFor(new Map(Object.entries(answers)));

	it("gives a quick question or a mechanical edit the weakest tier", () => {
		expect(
			tier({
				lookup: 0.9,
				mechanical: 0.1,
				design: 0.1,
				broad: 0.1,
				open: 0.1,
			}),
		).toBe(1);
		expect(
			tier({
				lookup: 0.1,
				mechanical: 0.8,
				design: 0.1,
				broad: 0.1,
				open: 0.1,
			}),
		).toBe(1);
	});

	it("gives light work that is neither a lookup nor mechanical the second tier", () => {
		expect(
			tier({
				lookup: 0.1,
				mechanical: 0.2,
				design: 0.1,
				broad: 0.1,
				open: 0.1,
			}),
		).toBe(2);
	});

	it("keeps a broad but mechanical change on the second tier", () => {
		expect(
			tier({
				lookup: 0.1,
				mechanical: 0.9,
				design: 0.1,
				broad: 0.8,
				open: 0.1,
			}),
		).toBe(2);
	});

	it("gives design, breadth or open-endedness the third tier, and all three the strongest", () => {
		expect(
			tier({
				lookup: 0.1,
				mechanical: 0.1,
				design: 0.8,
				broad: 0.1,
				open: 0.1,
			}),
		).toBe(3);
		expect(
			tier({
				lookup: 0.1,
				mechanical: 0.1,
				design: 0.8,
				broad: 0.8,
				open: 0.2,
			}),
		).toBe(3);
		expect(
			tier({
				lookup: 0.1,
				mechanical: 0.1,
				design: 0.8,
				broad: 0.8,
				open: 0.8,
			}),
		).toBe(4);
	});

	it("counts an unanswered question as a coin toss", () => {
		expect(tier({})).toBe(4);
	});
});
