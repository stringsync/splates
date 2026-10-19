import { describe, expect, it } from "bun:test";
import { scheduleOf } from "./schedule";

/** `at` in this machine's time, as cron reads it. */
const local = (at: string) => new Date(at).getTime();

describe("scheduleOf", () => {
	it("runs an interval that long after the last run", () => {
		const at = local("2026-10-19T10:00");

		expect(scheduleOf({ every: "30m" }).nextAfter(at)).toBe(
			local("2026-10-19T10:30"),
		);
		expect(scheduleOf({ every: "1d" }).nextAfter(at)).toBe(
			local("2026-10-20T10:00"),
		);
	});

	it("runs a cron line at the next minute it matches", () => {
		// 19 October 2026 is a Monday.
		const weekdays = scheduleOf({ cron: "0 9 * * 1-5" });

		expect(weekdays.nextAfter(local("2026-10-19T08:59"))).toBe(
			local("2026-10-19T09:00"),
		);
		expect(weekdays.nextAfter(local("2026-10-19T09:00"))).toBe(
			local("2026-10-20T09:00"),
		);
		expect(weekdays.nextAfter(local("2026-10-23T10:00"))).toBe(
			local("2026-10-26T09:00"),
		);
		expect(
			scheduleOf({ cron: "*/15 * * * *" }).nextAfter(local("2026-10-19T10:07")),
		).toBe(local("2026-10-19T10:15"));
		expect(
			scheduleOf({ cron: "0 0 1,15 * 0" }).nextAfter(local("2026-10-19T10:00")),
		).toBe(local("2026-10-25T00:00"));
	});

	it("refuses one that will not read", () => {
		expect(() => scheduleOf({ every: "0m" })).toThrow("no interval");
		expect(() => scheduleOf({ cron: "0 9 * *" })).toThrow("five fields");
		expect(() => scheduleOf({ cron: "0 9 * 13 *" })).toThrow("month");
		expect(() => scheduleOf({ cron: "a 9 * * *" })).toThrow("minute");
	});
});
