import { expect, test } from "bun:test";
import { FakeTimer } from "core/time/testing";
import { MemoryStorage } from "../storage/testing";
import { SignalBook } from "./book";
import { callOf, STANDARD_SIGNAL_FUNCTIONS } from "./call";
import { clockDuration, clockNext, normalizeClock } from "./clock-schedule";
import { Clocks } from "./clocks";

test("duration words and canonical units agree; guesses and old family name are refused", () => {
	expect(clockDuration("2 days")).toBe(172800000);
	expect(clockDuration("1s")).toBe(1000);
	expect(() => clockDuration("a while")).toThrow();
	expect(() =>
		callOf('clock.every("2d")', STANDARD_SIGNAL_FUNCTIONS),
	).toThrow();
	expect(
		callOf(
			'clock.interval({interval:"2 days",at:"9am",tz:"America/New_York"})',
			STANDARD_SIGNAL_FUNCTIONS,
		).canonical,
	).toBe(
		callOf(
			'clock.interval({interval:"48h",at:"09:00",tz:"America/New_York"})',
			STANDARD_SIGNAL_FUNCTIONS,
		).canonical,
	);
});

test("relative weekdays resolve in the chosen zone, and invalid dates refuse", () => {
	const args = { time: "next monday 9am", tz: "America/New_York" };
	normalizeClock("clock.at", args, Date.parse("2026-11-19T12:00:00Z"));
	expect(args.time).toBe("2026-11-23T14:00:00.000Z");
	expect(() =>
		normalizeClock("clock.at", { time: "2026-02-30", tz: "UTC" }),
	).toThrow();
	expect(() =>
		normalizeClock("clock.at", {
			time: "2027-03-14 02:30",
			tz: "America/New_York",
		}),
	).toThrow();
});

test("interval wall time stays at 9am across DST and cron uses the selected zone", () => {
	const args = { interval: "1d", at: "09:00", tz: "America/New_York" };
	expect(
		new Date(
			clockNext(
				"clock.interval",
				args,
				Date.parse("2027-03-13T14:00:00Z"),
				Date.parse("2027-03-13T14:00:00Z"),
			),
		).toISOString(),
	).toBe("2027-03-14T13:00:00.000Z");
	expect(
		new Date(
			clockNext(
				"clock.cron",
				{ expr: "0 9 * * 1", tz: "America/New_York" },
				0,
				Date.parse("2026-11-19T12:00:00Z"),
			),
		).toISOString(),
	).toBe("2026-11-23T14:00:00.000Z");
});

test("restart catches up once; inactive clocks do not fire; one-shot fires once", async () => {
	let now = Date.parse("2026-11-19T12:00:00Z");
	const book = new SignalBook(
		new MemoryStorage().document("signals.json"),
		() => now,
	);
	let active: string[] = [];
	const fired: string[] = [];
	const make = () =>
		new Clocks({
			book,
			now: () => now,
			timer: new FakeTimer(),
			active: async () => active,
			raise: async (name) => {
				fired.push(name);
			},
			error: () => {},
		});
	let runner = make();
	const name = callOf(
		'clock.interval({interval:"1h",tz:"UTC"})',
		STANDARD_SIGNAL_FUNCTIONS,
	).canonical;
	await runner.start(name);
	now += 10 * 3600000;
	await runner.tick();
	expect(fired).toHaveLength(0);
	active = [name];
	runner = make();
	await runner.tick();
	await runner.tick();
	expect(fired).toEqual([name]);
	expect((await book.clocks())[0]?.next).toBe("2026-11-19T23:00:00.000Z");
	const once = callOf(
		'clock.in({after:"1s",tz:"UTC"})',
		STANDARD_SIGNAL_FUNCTIONS,
	).canonical;
	await runner.start(once);
	active = [once];
	now += 1000;
	await runner.tick();
	await runner.tick();
	expect(fired).toEqual([name, once]);
});

test("stored raises preserve a call's time zone slash", async () => {
	const now = Date.now();
	const book = new SignalBook(
		new MemoryStorage().document("signals.json"),
		() => now,
	);
	const name = callOf(
		'clock.interval({interval:"2 days",tz:"America/New_York"})',
		STANDARD_SIGNAL_FUNCTIONS,
	).canonical;
	await book.raise(name, "clock", null);
	expect(Object.keys(await book.raises())).toEqual([name]);
	expect(
		await book.after(name, new Date(now - 1000).toISOString()),
	).not.toBeNull();
});

test("invalid schedules refuse and daily clocks skip nonexistent DST occurrences", () => {
	expect(() =>
		callOf('clock.cron("not cron")', STANDARD_SIGNAL_FUNCTIONS),
	).toThrow();
	expect(() =>
		callOf(
			'clock.interval({interval:"2h",at:"9am"})',
			STANDARD_SIGNAL_FUNCTIONS,
		),
	).toThrow();
	expect(() =>
		callOf(
			'clock.at({time:"tomorrow",tz:"No/Such_Zone"})',
			STANDARD_SIGNAL_FUNCTIONS,
		),
	).toThrow();
	expect(
		new Date(
			clockNext(
				"clock.interval",
				{ interval: "1d", at: "02:30", tz: "America/New_York" },
				Date.parse("2027-03-13T07:30:00Z"),
				Date.parse("2027-03-13T07:30:00Z"),
			),
		).toISOString(),
	).toBe("2027-03-15T06:30:00.000Z");
});
