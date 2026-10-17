import { describe, expect, it } from "bun:test";
import { capOf, HEAVY_JOBS_DEFAULT } from "./heavy";

describe("capOf", () => {
	it("reads the cap as a positive whole number, falling back on anything else", () => {
		expect(capOf("4")).toBe(4);
		expect(capOf(undefined)).toBe(HEAVY_JOBS_DEFAULT);
		expect(capOf("0")).toBe(HEAVY_JOBS_DEFAULT);
		expect(capOf("two")).toBe(HEAVY_JOBS_DEFAULT);
	});
});
