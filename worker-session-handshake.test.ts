import { beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { type Negotiated, WorkerProtocol } from "./worker-protocol";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

describe("WorkerSession handshake", () => {
	let timer: FakeTimer;
	let clock: FakeClock;
	let pair: WorkerSocketPair;
	let worker: WorkerSession;
	let coordinator: WorkerSession;

	beforeEach(() => {
		timer = new FakeTimer();
		clock = new FakeClock();
		pair = new WorkerSocketPair();
		worker = new WorkerSession("worker", {
			capabilities: ["pty", "ports"],
			timer,
			clock,
		});
		coordinator = new WorkerSession("coordinator", {
			capabilities: ["pty"],
			timer,
			clock,
		});
	});

	it("settles on the capabilities both ends have when a worker connects", async () => {
		const connecting = worker.connect(pair.worker, { id: "mac" });
		const hello = await WorkerSession.hello(pair.coordinator);

		const accepted = coordinator.accept(pair.coordinator, hello);

		const settled: Negotiated = {
			ok: true,
			protocol: WorkerProtocol.version,
			capabilities: ["pty"],
		};
		expect(accepted).toEqual(settled);
		expect(await connecting).toEqual(settled);
		expect(worker.connected).toBe(true);
	});

	it("hands the coordinator the worker's id and info in its hello", async () => {
		void worker.connect(pair.worker, {
			id: "mac",
			info: { slots: 8, platform: "darwin" },
		});

		expect(await WorkerSession.hello(pair.coordinator)).toMatchObject({
			id: "mac",
			info: { slots: 8, platform: "darwin" },
		});
	});

	// scry-ignore simple-test-setup: it speaks as a worker on another major by hand, which no session can, so its frames are its own
	it("refuses a worker on another major and hangs up, giving the reason", async () => {
		const answers: unknown[] = [];
		pair.worker.events.on("frame", (frame) =>
			answers.push(WorkerProtocol.decode(frame)),
		);
		pair.worker.send(
			JSON.stringify({
				type: "hello",
				protocol: "2.0",
				capabilities: [],
				id: "linux",
				info: {},
				held: [],
			}),
		);
		const hello = await WorkerSession.hello(pair.coordinator);

		const accepted = coordinator.accept(pair.coordinator, hello);
		await Bun.sleep(0);

		const reason =
			"the worker speaks protocol 2.0, and this end speaks 1.0: update the older one";
		expect(accepted).toEqual({ ok: false, reason });
		expect(answers).toEqual([{ type: "refuse", reason }]);
		expect(coordinator.connected).toBe(false);
	});

	it("tells a refused worker why its connect failed", async () => {
		const connecting = worker.connect(pair.worker, { id: "mac" });
		await WorkerSession.hello(pair.coordinator);

		pair.coordinator.send(
			WorkerProtocol.encode({ type: "refuse", reason: "drained" }),
		);

		expect(await connecting).toEqual({ ok: false, reason: "drained" });
		expect(worker.connected).toBe(false);
	});

	it("gives up on a welcome that never comes", async () => {
		const connecting = worker.connect(pair.worker, { id: "mac" });

		clock.advance(Duration.secs(31));
		timer.fireIntervals();

		expect(await connecting).toEqual({
			ok: false,
			reason: "nothing heard for 31s",
		});
	});

	it("rejects a first frame that is not a hello", async () => {
		pair.worker.send(WorkerProtocol.encode({ type: "ping", n: 0 }));

		await expect(WorkerSession.hello(pair.coordinator)).rejects.toThrow(
			"a worker opens with hello, not ping",
		);
	});

	it("hangs up on a frame it cannot read, even past the handshake", async () => {
		const connecting = worker.connect(pair.worker, { id: "mac" });
		coordinator.accept(
			pair.coordinator,
			await WorkerSession.hello(pair.coordinator),
		);
		await connecting;
		const lost: unknown[] = [];
		coordinator.events.on("lost", (event) => lost.push(event));

		pair.worker.send('{"type":"shout"}');
		await Bun.sleep(0);

		expect(lost).toMatchObject([
			{ reason: expect.stringContaining("a frame could not be read") },
		]);
	});

	it("numbers the channels each end opens apart, so neither waits on the other", () => {
		expect([
			worker.open("relay").id,
			coordinator.open("process").id,
			worker.open("relay").id,
			coordinator.open("process").id,
		]).toEqual([1, 2, 3, 4]);
	});
});
