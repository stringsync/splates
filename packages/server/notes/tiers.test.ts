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
	it("directs at most two likely notes, points at one more, and leaves the rest", () => {
		const tiered = tiers([
			found("a", 0.95),
			found("b", 0.9),
			found("c", 0.85),
			found("d", 0.75),
			found("e", 0.65),
		]);
		expect(tiered.map((each) => [each.path, each.tier])).toEqual([
			["a", "now"],
			["b", "now"],
			["c", "optional"],
			["d", null],
			["e", null],
		]);
	});

	it("skips a note in context, and directs one edited since it was read", () => {
		const tiered = tiers([
			found("a", 0.9, { inContext: true }),
			found("b", 0.75, { updated: true }),
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
