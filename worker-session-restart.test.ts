import { beforeEach, describe, expect, it } from "bun:test";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import type { WorkerChannel } from "./worker-channel";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("WorkerSession after the other end starts again", () => {
	let timer: FakeTimer;
	let clock: FakeClock;
	let worker: WorkerSession;
	let coordinator: WorkerSession;
	/** The coordinator's end of the channel open before either starts again. */
	let claude: WorkerChannel;
	/** The channels the worker was opened, in order. */
	let opened: WorkerChannel[];

	beforeEach(async () => {
		timer = new FakeTimer();
		clock = new FakeClock();
		worker = new WorkerSession("worker", { timer, clock });
		coordinator = new WorkerSession("coordinator", { timer, clock });
		opened = [];
		worker.events.on("channel", (channel) => opened.push(channel));
		await link(worker, coordinator);
		claude = coordinator.open("process", { argv: ["claude"] });
		await Bun.sleep(0);
	});

	it("ends the worker's channels when it joins a coordinator started again, and takes the new one's", async () => {
		const restarted = new WorkerSession("coordinator", { timer, clock });

		await link(worker, restarted);
		const next = restarted.open("process", { argv: ["codex"] });
		await Bun.sleep(0);

		expect(
			opened.map(({ id, params, closed }) => [id, params, closed]),
		).toEqual([
			[2, { argv: ["claude"] }, true],
			[2, { argv: ["codex"] }, false],
		]);
		expect(next.write(bytes("hi"))).toBe(true);
		// The coordinator gone never hears.
		expect(claude.closed).toBe(false);
	});

	it("ends the coordinator's channels when a worker started again joins it", async () => {
		const restarted = new WorkerSession("worker", { timer, clock });

		await link(restarted, coordinator);
		await Bun.sleep(0);

		expect(claude.closed).toBe(true);
		expect(coordinator.writable).toBe(true);
		// The worker gone never hears.
		expect(opened.map(({ closed }) => closed)).toEqual([false]);
	});
});

async function link(worker: WorkerSession, coordinator: WorkerSession) {
	const pair = new WorkerSocketPair();
	const connecting = worker.connect(pair.worker, { id: "mac" });
	coordinator.accept(
		pair.coordinator,
		await WorkerSession.hello(pair.coordinator),
	);
	return connecting;
}
