import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "core/log";
import { FakeTimer } from "core/time/testing";
import { MemoryStorage } from "../storage/testing";
import { SignalBook } from "./book";
import { type ProbeAsk, Probes, payloadOf } from "./probes";
import type { SignalProbe } from "./types";

const HOUR = 3_600_000;

describe("Probes", () => {
	let timer: FakeTimer;
	let now: number;
	let book: SignalBook;
	let exits: number[];
	let outputs: string[];
	let ran: string[];
	let raised: { name: string; payload: unknown }[];
	let waiting: number;
	let busy: boolean;
	let expired: string[];
	let shown: SignalProbe[];
	let probes: Probes;

	const make = () =>
		new Probes({
			book,
			shell: async (script, cwd) => {
				ran.push(`${cwd}: ${script}`);
				return {
					exitCode: exits.shift() ?? 1,
					stdout: outputs.shift() ?? "",
					stderr: "",
				};
			},
			busy: async () => busy,
			raise: async (name, _by, payload) => {
				raised.push({ name, payload });
				// A raise delivers to, and so ends, every wait on it.
				waiting = 0;
			},
			subscriptions: async () => waiting,
			expire: async (name) => {
				expired.push(name);
			},
			show: async (probe) => {
				shown.push(probe);
			},
			now: () => now,
			timer,
			log: new MemoryLogger(),
		});

	beforeEach(() => {
		timer = new FakeTimer();
		now = Date.parse("2026-11-19T12:00:00Z");
		book = new SignalBook(
			new MemoryStorage().document("signals.json"),
			() => now,
		);
		exits = [];
		outputs = [];
		ran = [];
		raised = [];
		waiting = 0;
		busy = false;
		expired = [];
		shown = [];
		probes = make();
	});

	const ask: ProbeAsk = {
		name: "aws.stack-ready",
		description: "stack up",
		script: "check-stack",
		everyMs: 5 * 60_000,
		timeoutMs: 6 * HOUR,
		cwd: "/repo",
		conversation: "c1",
	};

	/** Fires the pending scheduled run, the shortest timeout, and lets it finish. */
	const tick = async () => {
		const pending = timer.timeouts
			.map((entry, index) => ({ entry, index }))
			.filter(({ entry }) => !entry.disposed)
			.sort((one, two) => one.entry.delay.ms - two.entry.delay.ms);
		const first = pending[0];
		if (first !== undefined && first.entry.delay.ms < HOUR) {
			timer.fireTimeout(first.index);
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
		await (probes as unknown as { queue: Map<string, Promise<void>> }).queue
			.get(ask.name)
			?.catch(() => {});
	};

	const last = () => shown.at(-1);

	it("idles until a wait subscribes, then runs at once in the main tree", async () => {
		await probes.start(ask);
		expect(ran).toEqual([]);
		expect(last()?.state).toBe("idle");

		waiting = 1;
		await probes.subscribed(ask.name);

		expect(ran).toEqual(["/repo: check-stack"]);
		expect(last()).toMatchObject({ state: "running", passed: false, count: 1 });
	});

	it("raises on the edge from failing to passing, with stdout and checkedAt", async () => {
		waiting = 1;
		exits = [1, 0];
		outputs = ["", '{"status":"UPDATE_COMPLETE"}'];
		await probes.start(ask);
		expect(raised).toEqual([]);

		await tick();

		expect(raised).toEqual([
			{
				name: ask.name,
				payload: {
					status: "UPDATE_COMPLETE",
					checkedAt: "2026-11-19T12:00:00.000Z",
				},
			},
		]);
		expect(last()?.state).toBe("raised");
	});

	it("raises on a wait's first run when it passes", async () => {
		waiting = 1;
		exits = [0];
		await probes.start(ask);

		expect(raised).toHaveLength(1);
		expect(last()?.state).toBe("raised");
	});

	it("keeps running after a raise while something still subscribes, raising no more while it passes", async () => {
		const always = new Probes({
			book,
			shell: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
			busy: async () => false,
			raise: async (name, _by, payload) => {
				raised.push({ name, payload });
			},
			subscriptions: async () => 1,
			expire: async () => {},
			show: async (probe) => {
				shown.push(probe);
			},
			now: () => now,
			timer,
			log: new MemoryLogger(),
		});
		probes = always;
		await always.start(ask);
		await tick();
		await tick();

		expect(raised).toHaveLength(1);
		expect(last()).toMatchObject({ state: "running", count: 3 });
	});

	it("ends orphaned once its last subscription is gone, without running again", async () => {
		waiting = 1;
		await probes.start(ask);
		waiting = 0;

		await tick();

		expect(ran).toHaveLength(1);
		expect(last()?.state).toBe("orphaned");
	});

	it("skips a scheduled run while the machine is busy", async () => {
		waiting = 1;
		await probes.start(ask);
		busy = true;

		await tick();

		expect(ran).toHaveLength(1);
		expect(last()?.state).toBe("running");
	});

	it("times out at its deadline, waking its waits", async () => {
		waiting = 1;
		await probes.start(ask);
		now += 6 * HOUR;
		timer.fireTimeouts();
		await tick();

		expect(expired).toEqual([ask.name]);
		expect(last()?.state).toBe("timed out");
	});

	it("is replaced by a new probe on the same signal, its waits kept", async () => {
		waiting = 1;
		await probes.start(ask);
		await probes.start({ ...ask, script: "check-stack --v2" });

		expect(shown.map((each) => `${each.script} ${each.state}`)).toContain(
			"check-stack replaced",
		);
		expect(ran.at(-1)).toBe("/repo: check-stack --v2");
		expect(last()?.state).toBe("running");
	});

	it("stops when the person stops it", async () => {
		waiting = 1;
		await probes.start(ask);
		await probes.stop(ask.name);

		expect(last()?.state).toBe("stopped");
		expect(await book.probe(ask.name)).toMatchObject({ state: "stopped" });
	});

	it("refuses a probe more often than every 30s", () => {
		expect(probes.start({ ...ask, everyMs: 10_000 })).rejects.toThrow("30s");
	});

	it("takes back a running probe after a restart", async () => {
		waiting = 1;
		await probes.start(ask);
		probes.dispose();
		probes = make();
		await probes.arm();
		await tick();

		expect(ran).toHaveLength(2);
	});

	it("raises with stdout: a JSON object spread, anything else wrapped", () => {
		expect(payloadOf('{"a":1}', "t")).toEqual({ a: 1, checkedAt: "t" });
		expect(payloadOf("42", "t")).toEqual({ output: 42, checkedAt: "t" });
		expect(payloadOf("ready\n", "t")).toEqual({
			output: "ready",
			checkedAt: "t",
		});
		expect(payloadOf("", "t")).toEqual({ checkedAt: "t" });
	});
});
