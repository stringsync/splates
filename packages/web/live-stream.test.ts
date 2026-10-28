import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { LiveStream, RETRY } from "./live-stream";
import { Wakes } from "./wakes";

/** A stream the page opened, to say what the server would. */
interface Stream {
	onmessage: ((event: { data: string }) => void) | null;
	onopen: (() => void) | null;
	onerror: (() => void) | null;
	readyState: number;
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
	let dropped: number;
	let wakes: Wakes;

	beforeEach(() => {
		streams = [];
		opens = [];
		said = [];
		dropped = 0;
		timer = new FakeTimer();
		wakes = new Wakes(new FakeWallClock(), new FakeTimer());
		globalThis.EventSource = class {
			onmessage = null;
			onopen = null;
			onerror = null;
			readyState = 0;
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
				dropped: () => dropped++,
			},
			timer,
			wakes,
		);
	});

	afterEach(() => {
		live.dispose();
		wakes.dispose();
		globalThis.EventSource = Source;
	});

	it("does not open while disconnected and resumes on the next wake", () => {
		const navigator = globalThis.navigator;
		const online = navigator.onLine;
		Object.defineProperty(navigator, "onLine", {
			configurable: true,
			value: false,
		});
		try {
			live.reopen();
			wakes.woke();
			timer.fireTimeouts();
			expect(streams).toHaveLength(1);
			expect(streams[0]?.closed).toBe(true);
		} finally {
			Object.defineProperty(navigator, "onLine", {
				configurable: true,
				value: online,
			});
		}
		wakes.woke();
		expect(streams).toHaveLength(2);
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

	it("opens again at once when the page wakes, saying it dropped the one it had", () => {
		streams[0]?.onopen?.();

		wakes.woke();

		expect(dropped).toBe(1);
		expect(streams.map((each) => each.closed)).toEqual([true, false]);
		streams[1]?.onopen?.();
		expect(opens).toEqual([false, true]);
	});

	it("hears no wake once disposed", () => {
		live.dispose();

		wakes.woke();

		expect(dropped).toBe(0);
		expect(streams).toHaveLength(1);
	});

	it("tries again a stream that never opens", () => {
		timer.fireTimeouts();

		expect(streams).toHaveLength(2);
	});

	it("opens again soon after the browser gives up on it, as on a proxy's error", () => {
		const [stream] = streams;
		expect(stream).toBeDefined();
		Object.assign(stream ?? {}, { readyState: 2 });

		stream?.onerror?.();
		stream?.onerror?.();

		const retries = timer.timeouts.filter(
			(each) => !each.disposed && each.delay === RETRY,
		);
		expect(retries).toHaveLength(1);
		retries[0]?.callback();
		expect(dropped).toBe(1);
		expect(streams.map((each) => each.closed)).toEqual([true, false]);
	});

	it("leaves a stream the browser keeps trying to the browser", () => {
		streams[0]?.onerror?.();

		expect(timer.timeouts.some((each) => each.delay === RETRY)).toBe(false);
	});

	it("runs a burst of events together once it passes the first few", () => {
		streams[0]?.onopen?.();
		const data = Array.from({ length: 20 }, (_, each) => `${each}`);
		const hear = (each: string) => streams[0]?.onmessage?.({ data: each });
		data.map(hear);

		expect(said).toEqual(data.slice(0, 8));
		timer.fireTimeouts();

		expect(said).toEqual(data);
	});
});
