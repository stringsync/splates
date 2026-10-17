import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeTimer } from "webappwiz/time/testing";
import { LiveStream } from "./live-stream";

/** A stream the page opened, to say what the server would. */
interface Stream {
	onmessage: ((event: { data: string }) => void) | null;
	onopen: (() => void) | null;
	named: Map<string, (event: { data: string }) => void>;
	closed: boolean;
}

describe("LiveStream", () => {
	const Source = globalThis.EventSource;
	let streams: Stream[];
	let timer: FakeTimer;
	let live: LiveStream;
	let opens: boolean[];
	let said: string[];

	beforeEach(() => {
		streams = [];
		opens = [];
		said = [];
		timer = new FakeTimer();
		globalThis.EventSource = class {
			onmessage = null;
			onopen = null;
			readonly named = new Map();
			closed = false;
			constructor() {
				streams.push(this);
			}
			addEventListener(
				name: string,
				listener: (event: { data: string }) => void,
			): void {
				this.named.set(name, listener);
			}
			close(): void {
				this.closed = true;
			}
		} as unknown as typeof EventSource;
		live = new LiveStream(
			"/events",
			{
				message: (event) => said.push(event.data),
				open: (again) => opens.push(again),
			},
			timer,
		);
	});

	afterEach(() => {
		live.dispose();
		globalThis.EventSource = Source;
	});

	it("opens again once it hears nothing for two pulses, reading afresh on the new one", () => {
		streams[0]?.onopen?.();

		timer.fireTimeouts();

		expect(streams.map((each) => each.closed)).toEqual([true, false]);
		streams[1]?.onopen?.();
		expect(opens).toEqual([false, true]);
		streams[1]?.onmessage?.({ data: "moved" });
		expect(said).toEqual(["moved"]);
	});

	it("stays open while the server's pulse keeps coming", () => {
		streams[0]?.onopen?.();
		const waiting = timer.timeouts.length;

		streams[0]?.named.get("pulse")?.({ data: "" });

		// The wait for silence starts over: only the newest is still to fire.
		expect(timer.timeouts.length).toBe(waiting + 1);
		expect(timer.timeouts.filter((each) => !each.disposed)).toHaveLength(1);
		expect(streams).toHaveLength(1);
	});

	it("tries again a stream that never opens", () => {
		timer.fireTimeouts();

		expect(streams).toHaveLength(2);
	});
});
