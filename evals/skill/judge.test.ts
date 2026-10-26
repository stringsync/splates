import { expect, it } from "bun:test";
import { verdictOf } from "./judge";

it("reads the judge's JSON, and fails an answer it cannot read", () => {
	expect(verdictOf('Sure: {"pass": true, "reason": "scoped"}', 0.01)).toEqual({
		pass: true,
		reason: "scoped",
		usd: 0.01,
	});
	expect(verdictOf("I think so", null).pass).toBe(false);
});
