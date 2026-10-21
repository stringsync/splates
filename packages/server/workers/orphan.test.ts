import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { OrphanBound } from "./orphan";

describe("OrphanBound", () => {
	function bound() {
		const timer = new FakeTimer();
		const clock = new FakeClock();
		const told = { woke: 0, due: 0 };
		const orphan = new OrphanBound({
			bound: Duration.mins(10),
			timer,
			clock,
			woke: () => told.woke++,
			due: () => told.due++,
		});
		const tick = (after: Duration) => {
			clock.advance(after);
			timer.fireIntervals();
		};
		// Awake for `ticks` of ten seconds each.
		const awake = (ticks: number) => {
			for (let i = 0; i < ticks; i++) {
				tick(Duration.secs(10));
			}
		};
		return { orphan, tick, awake, told };
	}

	it("comes due once ten minutes pass awake", () => {
		const { awake, told } = bound();

		awake(59);
		expect(told).toEqual({ woke: 0, due: 0 });
		awake(2);

		expect(told).toEqual({ woke: 0, due: 1 });
	});

	it("counts an hour asleep as a tick, and says it woke so the worker redials", () => {
		const { tick, told } = bound();
		tick(Duration.secs(10));

		tick(Duration.hrs(1));

		expect(told).toEqual({ woke: 1, due: 0 });
	});

	it("comes due once the time awake on both sides of a sleep adds up to the bound", () => {
		const { tick, awake, told } = bound();
		awake(30);

		tick(Duration.hrs(1));
		awake(28);
		expect(told).toEqual({ woke: 1, due: 0 });
		awake(1);

		expect(told).toEqual({ woke: 1, due: 1 });
	});

	it("stops counting once disposed", () => {
		const { orphan, tick, told } = bound();

		orphan.dispose();
		tick(Duration.hrs(1));

		expect(told).toEqual({ woke: 0, due: 0 });
	});
});
