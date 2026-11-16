import { describe, expect, test } from "bun:test";
import { consoleLine, exceptionLine } from "./log-lines";

const START = Date.parse("2026-11-03T12:00:00.000Z");

describe("console", () => {
	test("a call is one line at Chrome's time, arguments joined", () => {
		expect(
			consoleLine(START + 5, "warning", [
				{ type: "string", value: "slow" },
				{ type: "number", value: 3 },
			]),
		).toBe("2026-11-03T12:00:00.005Z WARN  slow 3");
	});

	test("an exception names its error and where it threw", () => {
		const line = exceptionLine(START, {
			exception: { description: "TypeError: x is undefined\n    at a" },
			url: "http://app/main.js",
			lineNumber: 9,
		});
		expect(line).toBe(
			"2026-11-03T12:00:00.000Z EXCEPTION TypeError: x is undefined\\n    at a (http://app/main.js:10)",
		);
	});
});
