import { describe, expect, it } from "bun:test";
import { afterDecision } from "./decision";

describe("afterDecision", () => {
	it("drops a card's decision lines, keeping what follows", () => {
		expect(
			afterDecision(
				"Request changes: Limit\r\nPlan from 2026-11-26T12:00:00.000Z\r\n\r\nSmaller",
			),
		).toBe("Smaller");
		expect(afterDecision("Approve & review: Limit\nPlan from x")).toBe("");
		expect(afterDecision("Approve: Limit")).toBe("");
	});

	it("leaves a message with no titled decision alone", () => {
		expect(afterDecision("Approve")).toBeNull();
		expect(afterDecision("Looks good")).toBeNull();
	});
});
