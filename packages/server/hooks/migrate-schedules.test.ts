import { describe, expect, it } from "bun:test";
import type { SignalClock } from "../signals/clock-schedule";
import { MemoryStorage } from "../storage/testing";
import { migrateSchedules } from "./migrate-schedules";
import { RunStore } from "./runs";
import { HookStore } from "./store";

function shelf() {
	const clocks: SignalClock[] = [];
	return {
		clocks,
		clocksOf: async () => clocks,
		shelf: {
			clocks: async () => clocks,
			keepClock: async (clock: SignalClock) => {
				clocks.push(clock);
			},
		},
	};
}

describe("migrateSchedules", () => {
	it("moves every and cron onto clocks that keep their next due time", async () => {
		const storage = new MemoryStorage();
		const hooks = new HookStore(storage);
		const runs = new RunStore(storage);
		const run = { kind: "run" as const, command: "tidy" };
		await hooks.add({ every: "2h" }, run, "Tidy");
		await hooks.add({ cron: "0 9 * * 1" }, run);
		await hooks.add({ event: "task.created" }, run);
		const [first] = await hooks.read();
		const lastRun = "2099-01-01T00:00:00.000Z";
		await runs.scheduled(first?.id as string, lastRun);
		const kept = shelf();

		expect(await migrateSchedules(hooks, runs, kept.shelf, "UTC")).toBe(2);

		const [every, cron, event] = await hooks.read();
		expect(every?.name).toBe("Tidy");
		expect(every?.family).toBe("clock.interval");
		expect("signal" in (every?.trigger ?? {})).toBe(true);
		expect(cron?.family).toBe("clock.cron");
		expect(event?.trigger).toEqual({ event: "task.created" });
		expect(kept.clocks[0]?.next).toBe("2099-01-01T02:00:00.000Z");
		expect(kept.clocks[0]?.startedAt).toBe(lastRun);
		expect(kept.clocks[0]?.recurring).toBe(true);
		expect(kept.clocks[1]?.tz).toBe("UTC");

		// Nothing left to move the second time.
		expect(await migrateSchedules(hooks, runs, kept.shelf, "UTC")).toBe(0);
	});
});
