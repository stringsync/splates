import { describe, expect, it } from "bun:test";
import { duration } from "./stats-advice";

describe("duration", () => {
	it("reads in minutes, hours or days", () => {
		expect(
			[45 * 60_000, 3.2 * 3_600_000, 50 * 3_600_000].map(duration),
		).toEqual(["45m", "3.2h", "2.1d"]);
	});
});
