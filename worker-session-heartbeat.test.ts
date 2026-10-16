import { beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

describe("WorkerSession heartbeat", () => {
	let clock: FakeClock;
	let workerTimer: FakeTimer;
	let coordinatorTimer: FakeTimer;
	let worker: WorkerSession;
	let coordinator: WorkerSession;
	let lost: string[];

	beforeEach(async () => {
		clock = new FakeClock();
		workerTimer = new FakeTimer();
		coordinatorTimer = new FakeTimer();
		const pair = new WorkerSocketPair();
		worker = new WorkerSession("worker", { timer: workerTimer, clock });
		coordinator = new WorkerSession("coordinator", {
			timer: coordinatorTimer,
			clock,
		});
		const connecting = worker.connect(pair.worker, { id: "mac" });
		coordinator.accept(
			pair.coordinator,
			await WorkerSession.hello(pair.coordinator),
		);
		await connecting;
		lost = [];
		worker.events.on("lost", ({ reason }) => lost.push(`worker: ${reason}`));
		coordinator.events.on("lost", ({ reason }) =>
			lost.push(`coordinator: ${reason}`),
		);
	});

	it("keeps a link alive while both ends ping", async () => {
		clock.advance(Duration.secs(20));
		workerTimer.fireIntervals();
		coordinatorTimer.fireIntervals();
		await Bun.sleep(0);
		clock.advance(Duration.secs(20));
		workerTimer.fireIntervals();
		coordinatorTimer.fireIntervals();

		expect(lost).toEqual([]);
		expect(worker.connected).toBe(true);
		expect(coordinator.connected).toBe(true);
	});

	it("loses the link at the coordinator when the worker goes quiet", () => {
		clock.advance(Duration.secs(31));
		coordinatorTimer.fireIntervals();

		expect(lost).toEqual(["coordinator: nothing heard for 31s"]);
		expect(coordinator.connected).toBe(false);
	});

	it("loses the link at the worker when the coordinator goes quiet", () => {
		clock.advance(Duration.secs(31));
		workerTimer.fireIntervals();

		expect(lost).toEqual(["worker: nothing heard for 31s"]);
		expect(worker.connected).toBe(false);
	});
});
