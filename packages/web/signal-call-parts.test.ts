import { describe, expect, it } from "bun:test";
import { callParts, namespaceOf } from "./signal-summary";

describe("callParts", () => {
	it("splits a canonical call into its signal function and arguments", () => {
		expect(
			callParts('aws.stack-ready({ region: "us-west-2", stack: "a, (b)" })'),
		).toEqual({
			fn: "aws.stack-ready",
			args: [
				["region", "us-west-2"],
				["stack", "a, (b)"],
			],
		});
	});
	it("a bare name has no arguments, and dots in a value do not change its signal function", () => {
		expect(callParts("mdom.released")).toEqual({
			fn: "mdom.released",
			args: [],
		});
		expect(namespaceOf('clock.in({ after: "2.5 days" })')).toEqual({
			namespace: "clock",
			leaf: "in",
		});
	});
});
