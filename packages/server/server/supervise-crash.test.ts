import { beforeEach, describe, expect, it } from "bun:test";
import type { Resource } from "webappwiz/disposable";
import { FakePs } from "webappwiz/system/testing";
import { Duration, type Timer } from "webappwiz/time";
import { FakeClock } from "webappwiz/time/testing";
import { RESTART, supervise } from "./supervise";

describe("supervise, crashed", () => {
	let ps: FakePs;
	let clock: FakeClock;
	let pauses: number[];
	// Each pause passes at once, noted in seconds.
	const timer: Timer = {
		setTimeout(callback, delay): Resource {
			pauses.push(delay.secs);
			queueMicrotask(callback);
			return { dispose() {} };
		},
		setInterval(): Resource {
			return { dispose() {} };
		},
	};
	beforeEach(() => {
		ps = new FakePs();
		ps.args = ["server"];
		clock = new FakeClock();
		pauses = [];
	});

	// Each run ends with its code, after serving for its seconds; the last
	// is ended by Ctrl-C.
	const running = (...runs: [code: number, secs: number][]) => {
		ps.simulate(async () => {
			const [code, secs] = runs.shift() ?? [130, 0];
			clock.advance(Duration.secs(secs));
			if (runs.length === 0) {
				ps.dispatch("SIGINT");
			}
			return code;
		});
	};

	it("starts a crashed server again, waiting twice as long each time", async () => {
		running([1, 0], [137, 0], [1, 0], [130, 0]);

		expect(await supervise(ps, { timer, clock })).toBe(130);
		expect(ps.getCalls()).toHaveLength(4);
		expect(pauses).toEqual([2, 4, 8]);
	});

	it("gives up after five crashes in a row, each before it served a minute", async () => {
		running([1, 0], [1, 0], [1, 30], [1, 0], [1, 0], [0, 0]);

		expect(await supervise(ps, { timer, clock })).toBe(1);
		expect(ps.getCalls()).toHaveLength(5);
		expect(pauses).toEqual([2, 4, 8, 16]);
	});

	it("starts a new row of crashes after a server that served a while", async () => {
		running([1, 0], [1, 0], [1, 0], [1, 0], [1, 120], [1, 0], [130, 0]);

		expect(await supervise(ps, { timer, clock })).toBe(130);
		expect(ps.getCalls()).toHaveLength(7);
		expect(pauses).toEqual([2, 4, 8, 16, 2, 4]);
	});

	it.each([
		["the page shuts it down", 0],
		["Ctrl-C reaches it alone", 130],
		["a SIGTERM reaches it alone", 143],
	])("ends, without starting it again, when %s", async (_, code) => {
		ps.simulate(async () => code);

		expect(await supervise(ps, { timer, clock })).toBe(code);
		expect(ps.getCalls()).toHaveLength(1);
		expect(pauses).toEqual([]);
	});

	it("ends when Ctrl-C ended a server with another code", async () => {
		running([1, 0]);

		expect(await supervise(ps, { timer, clock })).toBe(1);
		expect(ps.getCalls()).toHaveLength(1);
	});

	it("restarts from the page at once, without a pause", async () => {
		running([RESTART, 0], [130, 0]);

		await supervise(ps, { timer, clock });
		expect(ps.getCalls()).toHaveLength(2);
		expect(pauses).toEqual([]);
	});

	it("keeps the Mac awake while it runs, and lets it sleep once it ends", async () => {
		running([130, 0]);
		ps.pid = 4242;
		const started: string[] = [];
		const start = ps.start.bind(ps);
		ps.start = (argv, opts) => {
			started.push(argv.join(" "));
			return start(argv, opts);
		};

		await supervise(ps, { awake: true, timer, clock });
		expect(started).toEqual(["caffeinate -ims -w 4242"]);
		expect(ps.getChildren()[0]?.signals).toEqual(["SIGTERM"]);
	});

	it("keeps no Mac awake unless asked", async () => {
		running([130, 0]);

		await supervise(ps, { timer, clock });
		expect(ps.getChildren()).toEqual([]);
	});
});
