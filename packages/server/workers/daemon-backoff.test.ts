import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { jittered } from "./daemon";

describe("jittered", () => {
	it("waits somewhere in the latter half of the backoff", () => {
		const wait = Duration.secs(10);

		expect(jittered(wait, () => 0).ms).toBe(5000);
		expect(jittered(wait, () => 0.5).ms).toBe(7500);
		expect(jittered(wait, () => 0.999).ms).toBeLessThanOrEqual(10_000);
	});
});
