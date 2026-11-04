import { describe, expect, test } from "bun:test";
import { Duration } from "core/time";
import { FakeClock } from "core/time/testing";
import { QueueCapacity } from "./load";

const spare = { cpu: 0.3, memory: 0.5, load: 36, cores: 16 };

describe("QueueCapacity", () => {
	test("releases spare capacity after ten seconds despite lingering load", () => {
		const clock = new FakeClock();
		const capacity = new QueueCapacity(clock);
		expect(capacity.overloaded(1.5, spare)).toBe(true);
		expect(capacity.reading?.recoverySeconds).toBe(10);
		clock.advance(Duration.secs(5));
		expect(capacity.overloaded(1.5, spare)).toBe(true);
		expect(capacity.reading?.recoverySeconds).toBe(5);
		clock.advance(Duration.secs(5));
		expect(capacity.overloaded(1.5, spare)).toBe(false);
	});
	test("restarts recovery after a pause longer than the recovery window", () => {
		const clock = new FakeClock();
		const capacity = new QueueCapacity(clock);
		capacity.overloaded(1.5, spare);
		clock.advance(Duration.secs(5));
		capacity.overloaded(1.5, spare);
		expect(capacity.reading?.recoverySeconds).toBe(5);
		clock.advance(Duration.secs(20));
		expect(capacity.overloaded(1.5, spare)).toBe(true);
		expect(capacity.reading?.recoverySeconds).toBe(10);
		clock.advance(Duration.secs(5));
		expect(capacity.overloaded(1.5, spare)).toBe(true);
		clock.advance(Duration.secs(5));
		expect(capacity.overloaded(1.5, spare)).toBe(false);
	});
	test("resets recovery if pressure returns and holds for memory even with low load", () => {
		const clock = new FakeClock();
		const capacity = new QueueCapacity(clock);
		capacity.overloaded(1.5, spare);
		clock.advance(Duration.secs(9));
		expect(capacity.overloaded(1.5, { ...spare, load: 2, memory: 0.92 })).toBe(
			true,
		);
		clock.advance(Duration.secs(5));
		expect(capacity.overloaded(1.5, spare)).toBe(true);
		expect(capacity.reading?.recoverySeconds).toBe(10);
	});
	test("holds on CPU pressure even when load is low, but null disables automatic holds", () => {
		const capacity = new QueueCapacity();
		expect(capacity.overloaded(1.5, { ...spare, load: 2, cpu: 0.95 })).toBe(
			true,
		);
		expect(capacity.overloaded(null, { ...spare, cpu: 1, memory: 1 })).toBe(
			false,
		);
	});
});
