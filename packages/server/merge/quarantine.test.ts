import { describe, expect, test } from "bun:test";
import type { Event } from "../records";
import { allQuarantined, quarantinedOf } from "./quarantine";

const NOW = Date.parse("2026-10-31T12:00:00Z");

function flake(at: string, name = "a > b", file = "x.test.ts"): Event {
	return {
		action: "merge",
		at,
		failureAttribution: "flake",
		failedTests: [{ name, file, message: "" }],
	} as unknown as Event;
}

describe("quarantine", () => {
	test("leaves a test with one flake out of quarantine", () => {
		expect(quarantinedOf([flake("2026-10-30T00:00:00Z")], NOW)).toEqual([]);
	});

	test("quarantines a test after two flakes in the window", () => {
		const found = quarantinedOf(
			[flake("2026-10-29T00:00:00Z"), flake("2026-10-30T00:00:00Z")],
			NOW,
		);
		expect(found).toEqual([
			{
				name: "a > b",
				file: "x.test.ts",
				flakes: 2,
				last: "2026-10-30T00:00:00Z",
			},
		]);
	});

	test("ignores a flake outside the window", () => {
		expect(
			quarantinedOf(
				[flake("2026-10-01T00:00:00Z"), flake("2026-10-30T00:00:00Z")],
				NOW,
			),
		).toEqual([]);
	});

	const quarantined = [
		{ name: "a > b", file: "x.test.ts", flakes: 2, last: "" },
	];

	test("excuses a failure of only quarantined tests", () => {
		expect(
			allQuarantined(
				[{ name: "a > b", file: "x.test.ts", message: "" }],
				quarantined,
			),
		).toBe(true);
	});

	test("refuses to excuse another failing test, or none named", () => {
		expect(
			allQuarantined(
				[
					{ name: "a > b", file: "x.test.ts", message: "" },
					{ name: "c", file: "y.test.ts", message: "" },
				],
				quarantined,
			),
		).toBe(false);
		expect(allQuarantined([], quarantined)).toBe(false);
	});
});
