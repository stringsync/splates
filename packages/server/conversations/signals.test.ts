import { beforeEach, describe, expect, it } from "bun:test";
import { FakeTimer } from "core/time/testing";
import type { Entry } from "./entry";
import type { ConversationDeps, ConversationHost } from "./host";
import { ConversationSignals, wakeOf } from "./signals";
import type { ConversationState } from "./state";

const HOUR = 3_600_000;

describe("ConversationSignals", () => {
	let timer: FakeTimer;
	let now: number;
	let state: Pick<ConversationState, "signals">;
	let written: Entry[];
	let said: string[];
	let signals: ConversationSignals;

	const make = () =>
		new ConversationSignals(
			{
				state,
				log: { write: (entry: Entry) => written.push(entry) },
				now: () => new Date(now).toISOString(),
				changed: () => {},
			} as unknown as ConversationHost,
			{ timer, clock: { now: () => now } } as unknown as ConversationDeps,
			async (text) => {
				said.push(text);
			},
		);

	beforeEach(() => {
		timer = new FakeTimer();
		now = Date.parse("2026-11-18T12:00:00Z");
		state = { signals: [] };
		written = [];
		said = [];
		signals = make();
	});

	const ask = {
		name: "mdom.released",
		description: "mdom on npm",
		timeoutMs: 5 * HOUR,
		since: null,
	};

	it("waits, then wakes the agent once with the raise's payload", () => {
		signals.begin(ask, "w1");
		expect(state.signals[0]).toMatchObject({ id: "w1", state: "waiting" });
		expect(state.signals[0]?.deadline).toBe("2026-11-18T17:00:00.000Z");

		const raise = { at: "t", by: "bump-mdom", payload: { version: "2.4.0" } };
		expect(signals.deliver("mdom.released", raise)).toBe(1);
		expect(signals.deliver("mdom.released", raise)).toBe(0);

		expect(state.signals[0]).toMatchObject({ state: "raised", raise });
		expect(said).toHaveLength(1);
		expect(said[0]).toContain("[SPLATES SIGNAL mdom.released]");
		expect(said[0]).toContain('{"version":"2.4.0"}');
	});

	it("delivers to every wait on the name, and to none on another", () => {
		signals.begin(ask, "w1");
		signals.begin(ask, "w2");
		signals.begin({ ...ask, name: "mdom/other" }, "w3");

		expect(
			signals.deliver("mdom.released", { at: "t", by: "x", payload: null }),
		).toBe(2);
		expect(state.signals.map((each) => each.state)).toEqual([
			"raised",
			"raised",
			"waiting",
		]);
	});

	it("times out with a wake saying so", () => {
		signals.begin(ask, "w1");
		now += 5 * HOUR;
		timer.fireTimeouts();

		expect(state.signals[0]?.state).toBe("timed out");
		expect(said).toEqual(["[SPLATES SIGNAL mdom.released] timeout"]);
	});

	it("ends at once on a raise the since already reaches", () => {
		const already = { at: "t", by: "x", payload: 1 };
		signals.begin({ ...ask, since: "s", already }, "w1");

		expect(state.signals[0]?.state).toBe("raised");
		expect(said).toHaveLength(1);
	});

	it("stops at the person's word, once", () => {
		signals.begin(ask, "w1");
		signals.stop("w1");
		signals.stop("w1");

		expect(state.signals[0]?.state).toBe("stopped");
		expect(said).toEqual(["[SPLATES SIGNAL mdom.released] stopped"]);
	});

	it("arms the deadline of a wait a log left waiting", () => {
		signals.begin(ask, "w1");
		signals.dispose();
		const again = make();
		again.arm();
		now += 6 * HOUR;
		timer.fireTimeouts();

		expect(state.signals[0]?.state).toBe("timed out");
	});

	it("refuses a timeout under a second or over a week", () => {
		expect(() => signals.begin({ ...ask, timeoutMs: 10 }, "a")).toThrow();
		expect(() =>
			signals.begin({ ...ask, timeoutMs: 8 * 24 * HOUR }, "a"),
		).toThrow();
	});

	it("words a wake", () => {
		expect(
			wakeOf({
				id: "",
				name: "a/b",
				description: "",
				state: "stopped",
				startedAt: "",
				deadline: "",
				since: null,
			}),
		).toBe("[SPLATES SIGNAL a/b] stopped");
	});
});
