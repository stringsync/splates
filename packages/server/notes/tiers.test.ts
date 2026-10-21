import { describe, expect, it } from "bun:test";
import { type Found, pointersOf, tiers } from "./index";

const found = (
	path: string,
	probability: number,
	more: Partial<Found> = {},
) => ({
	path,
	description: `about ${path}`,
	probability,
	inContext: false,
	updated: false,
	...more,
});

describe("tiers", () => {
	it("directs at most two likely notes, points at three more, and leaves the unlikely", () => {
		const tiered = tiers([
			found("a", 0.95),
			found("b", 0.9),
			found("c", 0.85),
			found("d", 0.6),
			found("e", 0.55),
			found("f", 0.51),
			found("g", 0.3),
		]);
		expect(tiered.map((each) => [each.path, each.tier])).toEqual([
			["a", "now"],
			["b", "now"],
			["c", "optional"],
			["d", "optional"],
			["e", "optional"],
			["f", null],
			["g", null],
		]);
	});

	it("skips a note in context, and directs one edited since it was read", () => {
		const tiered = tiers([
			found("a", 0.9, { inContext: true }),
			found("b", 0.6, { updated: true }),
		]);
		expect(tiered.map((each) => each.tier)).toEqual([null, "now"]);
		expect(pointersOf(tiered)).toBe(
			"Read before acting: b (updated since you read it): about b",
		);
	});

	it("attaches nothing when nothing applies", () => {
		expect(pointersOf(tiers([found("a", 0.2)]))).toBeNull();
	});
});
