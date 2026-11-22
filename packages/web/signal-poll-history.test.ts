import { describe, expect, it } from "bun:test";
import { tookOf } from "./signal-poll-history";

describe("tookOf", () => {
	it("says seconds to a tenth under a minute, then minutes and seconds", () => {
		expect([tookOf(400), tookOf(12_000), tookOf(65_000)]).toEqual([
			"0.4s",
			"12.0s",
			"1m 5s",
		]);
	});
});
