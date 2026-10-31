import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "core/log";
import { Duration } from "core/time";
import { FakeClock, FakeTimer } from "core/time/testing";
import { LoopWatch } from "./loop-watch";

describe("LoopWatch", () => {
	it("records a stalled loop once, measuring how late the interval ran", () => {
		const log = new MemoryLogger();
		const clock = new FakeClock();
		const timer = new FakeTimer();
		const watch = new LoopWatch(log, { clock, timer });
		clock.advance(Duration.secs(1));
		timer.fireIntervals();
		expect(log.entries).toEqual([]);

		clock.advance(Duration.secs(36));
		timer.fireIntervals();
		clock.advance(Duration.secs(1));
		timer.fireIntervals();
		expect(log.entries.map((each) => each.message)).toEqual([
			"splates server event loop delayed by 35s",
		]);

		watch.dispose();
		clock.advance(Duration.secs(36));
		timer.fireIntervals();
		expect(log.entries).toHaveLength(1);
	});
});
