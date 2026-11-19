import { describe, expect, it } from "bun:test";
import { shipCardRefusal } from "./ship-card-watch";

describe("shipCardRefusal", () => {
	it("gives the reason and what to do about it", () => {
		const words = shipCardRefusal('"net" takes no bump');
		expect(words).toContain('"net" takes no bump');
		expect(words).toContain("plan");
		expect(words).toContain("corrected card");
	});
});
