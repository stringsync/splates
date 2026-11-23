import { describe, expect, it } from "bun:test";
import type { Limit } from "@splates/server/conversations";
import { firstRunOut, lengthOf, paceOf } from "./plan-limits";

const HOUR = 3_600_000;
const now = Date.parse("2026-11-22T15:00:00.000Z");
const at = (offset: number) => new Date(now + offset).toISOString();

const limit = (
	window: string,
	used: number,
	resetsIn: number,
	saidAgo = 0,
): Limit => ({ window, used, resets: at(resetsIn), at: at(-saidAgo) });

describe("pace", () => {
	it("knows a window's length for Claude's, Codex's and Antigravity's windows, and no others", () => {
		expect(lengthOf("five_hour")).toBe(5 * HOUR);
		expect(lengthOf("seven_day")).toBe(7 * 24 * HOUR);
		expect(lengthOf("seven_day_opus")).toBe(7 * 24 * HOUR);
		expect(lengthOf("month")).toBe(30 * 24 * HOUR);
		expect(lengthOf("43200_minutes")).toBe(30 * 24 * HOUR);
		expect(lengthOf("Gemini Models · Five Hour")).toBe(5 * HOUR);
		expect(lengthOf("Gemini Models · Weekly")).toBe(7 * 24 * HOUR);
		expect(lengthOf("Antigravity quota")).toBeNull();
	});

	it("averages use since the window began and says when it runs out before reset", () => {
		// 3h into a 5-hour window at 75%: 25%/h, out in 1h, 1h before reset.
		const pace = paceOf(limit("five_hour", 0.75, 2 * HOUR), now);
		expect(pace?.label).toBe("25%/h");
		expect(pace?.runsOut).toBe(now + HOUR);
	});

	it("measures from when the agent said, not from now", () => {
		// Said 1h ago, 2h into the window at 50%: out 2h after it was said.
		const pace = paceOf(limit("five_hour", 0.5, 2 * HOUR, HOUR), now);
		expect(pace?.label).toBe("25%/h");
		expect(pace?.runsOut).toBe(now + HOUR);
	});

	it("gives no run-out time when the pace lasts past the reset", () => {
		// 1 day into a week at 12%: 12%/day, 84% by reset.
		const pace = paceOf(limit("seven_day", 0.12, 6 * 24 * HOUR), now);
		expect(pace?.label).toBe("12%/day");
		expect(pace?.runsOut).toBeNull();
	});

	it("shows nothing in a window's first tenth, past its reset, or of unknown length", () => {
		expect(paceOf(limit("five_hour", 0.2, 4.75 * HOUR), now)).toBeNull();
		expect(paceOf(limit("five_hour", 0.9, -HOUR), now)).toBeNull();
		expect(paceOf(limit("Antigravity quota", 0.9, HOUR), now)).toBeNull();
		expect(
			paceOf({ window: "five_hour", used: 0.5, resets: null, at: null }, now),
		).toBeNull();
	});

	it("gives no run-out time once the window is used up", () => {
		const pace = paceOf(limit("five_hour", 1, HOUR), now);
		expect(pace?.label).toBe("25%/h");
		expect(pace?.runsOut).toBeNull();
	});

	it("names the window that runs out first, of those that run out before reset", () => {
		const fast = limit("seven_day", 0.9, 24 * HOUR);
		const faster = limit("five_hour", 0.75, 2 * HOUR);
		const calm = limit("five_hour", 0.1, 2 * HOUR);
		expect(firstRunOut([fast, faster, calm], now)?.limit).toBe(faster);
		expect(firstRunOut([calm], now)).toBeNull();
	});
});
