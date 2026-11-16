import { describe, expect, test } from "bun:test";
import { MAX_SHOTS, parseVideoTime, planSlice } from "./slice";

describe("slice", () => {
	test("video time is seconds or m:ss", () => {
		expect(parseVideoTime("83")).toBe(83);
		expect(parseVideoTime("1:23")).toBe(83);
		expect(parseVideoTime("1:00:01")).toBe(3601);
		expect(() => parseVideoTime("soon")).toThrow();
	});

	test("the window is padded and clamped to the recording, with a still at the moment", () => {
		const plan = planSlice({ at: 2, before: 5, after: 5, length: 60 });
		expect([plan.from, plan.to]).toEqual([0, 7]);
		expect(plan.shots).toContain(2);
		expect(plan.shots.at(-1)).toBeLessThanOrEqual(7);
	});

	test("a long span keeps to the most stills", () => {
		const plan = planSlice({ at: 100, before: 60, after: 60, length: 600 });
		expect(plan.shots.length).toBeLessThanOrEqual(MAX_SHOTS + 1);
		expect(plan.shots).toContain(100);
	});
});
