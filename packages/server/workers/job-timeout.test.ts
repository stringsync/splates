import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { DEFAULT_JOB_TIMEOUT, jobTimeout, parseTimeout } from "./job-timeout";

describe("a job's timeout", () => {
	it("reads a length of time as people write it, minutes when it names no unit", () => {
		expect(parseTimeout("30")?.ms).toBe(Duration.mins(30).ms);
		expect(parseTimeout("30m")?.ms).toBe(Duration.mins(30).ms);
		expect(parseTimeout("90s")?.ms).toBe(Duration.secs(90).ms);
		expect(parseTimeout("1.5h")?.ms).toBe(Duration.mins(90).ms);
		expect(parseTimeout("soon")).toBeNull();
		expect(parseTimeout("0")).toBeNull();
	});

	it("takes a command's override over the project's setting over 30 minutes", () => {
		expect(jobTimeout(undefined).ms).toBe(DEFAULT_JOB_TIMEOUT.ms);
		expect(jobTimeout({ timeout: 45 }).ms).toBe(Duration.mins(45).ms);
		expect(jobTimeout({ timeout: "2h" }).ms).toBe(Duration.hrs(2).ms);
		expect(jobTimeout({ timeout: "2h" }, Duration.secs(10)).ms).toBe(
			Duration.secs(10).ms,
		);
	});

	it("refuses a timeout setting that is no length of time", () => {
		expect(() => jobTimeout({ timeout: "forever" })).toThrow('"forever"');
	});
});
