import { beforeEach, describe, expect, it } from "bun:test";
import type { Resource } from "webappwiz/disposable";
import { FakePs } from "webappwiz/system/testing";
import { Duration, type Timer } from "webappwiz/time";
import { FakeClock } from "webappwiz/time/testing";
import { RESTART, supervise } from "./supervise";

describe("supervise, kept up", () => {
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
		ps.args = ["server", "--macos"];
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

	it("starts a failed server again, waiting twice as long each time up to a minute, and ends on Ctrl-C", async () => {
		running([1, 0], [1, 0], [0, 0], [1, 0], [1, 0], [1, 0], [1, 0], [130, 0]);

		expect(await supervise(ps, { keepUp: true, timer, clock })).toBe(130);
		expect(ps.getCalls()).toHaveLength(8);
		expect(pauses).toEqual([2, 4, 8, 16, 32, 60, 60]);
	});

	it("waits the shortest pause again after a server that served a while", async () => {
		running([1, 0], [1, 0], [1, 120], [1, 0], [130, 0]);

		await supervise(ps, { keepUp: true, timer, clock });
		expect(pauses).toEqual([2, 4, 2, 4]);
	});

	it("restarts from the page at once, without a pause", async () => {
		running([RESTART, 0], [130, 0]);

		await supervise(ps, { keepUp: true, timer, clock });
		expect(ps.getCalls()).toHaveLength(2);
		expect(pauses).toEqual([]);
	});

	it("ends with a server that fails when not kept up", async () => {
		running([1, 0], [0, 0]);

		expect(await supervise(ps, { timer, clock })).toBe(1);
		expect(ps.getCalls()).toHaveLength(1);
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
