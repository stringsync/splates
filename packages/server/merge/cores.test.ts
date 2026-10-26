import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { GateTrail, gateCores, lingering } from "./cores";

describe("gate cores", () => {
	let fs: FakeFs;
	let wall: FakeWallClock;
	let load: number;
	let trail: () => GateTrail;

	beforeEach(() => {
		fs = new FakeFs();
		wall = new FakeWallClock();
		load = 0;
		trail = () =>
			new GateTrail(
				fs,
				"/home/gate.last",
				{ cores: () => 16, loadavg: () => [load] },
				wall,
			);
	});

	it("runs a worker on each core the load leaves idle, from half the cores to all but two", () => {
		expect(gateCores(16, 1.5)).toBe(14);
		expect(gateCores(16, 5.2)).toBe(10);
		expect(gateCores(16, 10)).toBe(8);
		expect(gateCores(16, 32)).toBe(8);
		expect(gateCores(2, 0)).toBe(1);
	});

	it("counts what an ended run still adds to the load: its share built up by its end, decayed by e^(-t/60s) since", () => {
		const after = (ran: Duration, since: Duration) =>
			lingering({ workers: 10, ran, since });

		expect(after(Duration.hrs(1), Duration.ms(0))).toBeCloseTo(10);
		expect(after(Duration.hrs(1), Duration.mins(1))).toBeCloseTo(10 / Math.E);
		expect(after(Duration.mins(1), Duration.ms(0))).toBeCloseTo(
			10 * (1 - 1 / Math.E),
		);
	});

	it("gives a gate right after another its full count, not the load its predecessor left behind", async () => {
		load = 2;
		expect(await trail().size()).toBe(14);
		await trail().ran(14, Duration.secs(80));

		load = 10;

		expect(await trail().size()).toBe(14);
	});

	it("still counts the person's load beyond what the gate before left, as that share fades", async () => {
		await trail().ran(14, Duration.secs(80));
		// About 10.3 of it is the gate's, 7.7 the person's.
		load = 18;
		expect(await trail().size()).toBe(8);

		wall.advance(Duration.mins(1));
		// The gate's share is down to about 3.8, the person's to 2.2.
		load = 6;

		expect(await trail().size()).toBe(13);
	});

	it("counts the whole load when no gate ran before", async () => {
		load = 10;

		expect(await trail().size()).toBe(8);
	});
});
