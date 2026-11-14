import { describe, expect, it } from "bun:test";
import { plainWhy } from "./unsent-why";

describe("plainWhy", () => {
	it("says a timeout in seconds", () => {
		expect(plainWhy("Sending timed out")).toBe(
			"the server didn't answer within 30s.",
		);
		expect(plainWhy("no answer in 30s")).toBe(
			"the server didn't answer within 30s.",
		);
	});

	it("says a dropped or missing connection", () => {
		expect(plainWhy("Lost the connection before the server had it")).toBe(
			"the connection dropped before the server had it.",
		);
		expect(plainWhy("Failed to fetch")).toBe(
			"the network is down or the server can't be reached.",
		);
	});

	it("passes the server's own words on", () => {
		expect(plainWhy("cannot resume")).toBe(
			"the server refused it: cannot resume.",
		);
	});
});
