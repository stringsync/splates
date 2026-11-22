import { describe, expect, it } from "bun:test";
import { FakeTimer } from "core/time/testing";
import { MemoryStorage } from "../storage/testing";
import { SignalBook } from "./book";
import { SignalExpiration } from "./expiration";
import { expirationOf } from "./time";

const START = Date.parse("2026-11-19T12:00:00Z");

describe("signal expiration", () => {
	it("reads durations and dates, refusing zero, past and ambiguous times", () => {
		expect(expirationOf("2h", START)).toBe("2026-11-19T14:00:00.000Z");
		expect(expirationOf("2026-12-01", START)).toBe("2026-12-01T00:00:00.000Z");
		expect(expirationOf("2026-12-01T17:00:00-05:00", START)).toBe(
			"2026-12-01T22:00:00.000Z",
		);
		expect(() => expirationOf("0s", START)).toThrow("expiration");
		expect(() => expirationOf("-2h", START)).toThrow("expiration");
		expect(() => expirationOf("nonsense", START)).toThrow("expiration");
		expect(() => expirationOf("2026-11-18", START)).toThrow("expiration");
		expect(() => expirationOf("2026-12-01T17:00:00", START)).toThrow(
			"expiration",
		);
	});

	it("removes at the persisted deadline after restart, leaving permanent signals intact", async () => {
		let now = START;
		const storage = new MemoryStorage();
		const book = new SignalBook(storage.document("signals.json"), () => now);
		await book.raise("test.temporary", "test", 1);
		await book.keepClock({
			name: "test.temporary",
			meaning: "test",
			tz: "UTC",
			next: new Date(now + 1000).toISOString(),
			startedAt: new Date(now).toISOString(),
			recurring: true,
		});
		await book.raise("test.permanent", "test", 2);
		await book.expireAt("test.temporary", expirationOf("2h", now));
		now += 7_200_000;
		const restarted = new SignalBook(
			storage.document("signals.json"),
			() => now,
		);
		const removed: string[] = [];
		const expiration = new SignalExpiration({
			book: restarted,
			now: () => now,
			timer: new FakeTimer(),
			remove: async (name) => {
				removed.push(name);
			},
			error: () => {},
		});
		await expiration.arm();
		expect(removed).toEqual(["test.temporary"]);
		expect(await restarted.expirations()).toEqual({});
		expect(await restarted.clocks()).toEqual([]);
		expect(Object.keys(await restarted.raises())).toEqual(["test.permanent"]);
		expect(await restarted.removed()).toEqual(["test.temporary"]);
		await restarted.raise("test.temporary", "test", 3);
		expect(await restarted.removed()).toEqual([]);
		expiration.dispose();
	});

	it("honors changed and cleared deadlines and cancels its timer on disposal", async () => {
		let now = START;
		const book = new SignalBook(
			new MemoryStorage().document("signals.json"),
			() => now,
		);
		const timer = new FakeTimer();
		const removed: string[] = [];
		const expiration = new SignalExpiration({
			book,
			now: () => now,
			timer,
			remove: async (name) => {
				removed.push(name);
			},
			error: () => {},
		});
		await book.expireAt("test.signal", expirationOf("1s", now));
		await expiration.arm();
		await book.expireAt("test.signal", expirationOf("2h", now));
		await expiration.arm();
		now += 1000;
		timer.fireTimeouts();
		await expiration.arm();
		expect(removed).toEqual([]);
		await book.expireAt("test.signal", null);
		now += 7_200_000;
		await expiration.arm();
		expect(removed).toEqual([]);
		expiration.dispose();
		expect(timer.timeouts.every((each) => each.disposed)).toBe(true);
	});
});
