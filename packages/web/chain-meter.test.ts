import { describe, expect, it } from "bun:test";
import { chainSpendOf } from "@splates/server/queue/browser";

describe("chainSpendOf", () => {
	it("reads the meter from the out-of-budget question", () => {
		expect(
			chainSpendOf(
				"How much more may the agent-enqueue-setting chain spend?",
				"It spent 5.0M of 5M; #826 wants to queue #831 Split the fixture loader (about 0.6M).",
			),
		).toEqual({
			chain: "agent-enqueue-setting",
			spent: "5.0M",
			budget: "5M",
			share: 1,
		});
	});

	it("leaves other questions without one", () => {
		expect(
			chainSpendOf("Keep the old endpoint?", "It spent 5M of 5M"),
		).toBeNull();
	});
});
