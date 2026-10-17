import { beforeEach, describe, expect, it } from "bun:test";
import { type FakeChild, FakeFs, FakePs } from "webappwiz/system/testing";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import type { AgentFrame } from "./agent-process";
import { eventually } from "./conversation-testing";
import type { RemoteProcess } from "./remote-process";
import { RemoteWorker } from "./remote-worker";
import { WorkerDaemon } from "./worker-daemon";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

describe("RemoteWorker after the coordinator restarts", () => {
	let timer: FakeTimer;
	let clock: FakeClock;
	let ps: FakePs;
	let coordinator: WorkerSession;
	let remote: RemoteWorker;
	let pair: WorkerSocketPair;
	/** A process started before the restart, and the worker's child for it. */
	let before: RemoteProcess;
	let child: FakeChild | undefined;

	beforeEach(async () => {
		timer = new FakeTimer();
		clock = new FakeClock();
		ps = new FakePs();
		pair = new WorkerSocketPair();
		const daemon = new WorkerDaemon(
			{ where: "memory", dial: async () => pair.worker },
			{
				id: "local",
				slots: 1,
				ps,
				fs: new FakeFs(),
				log: { info: () => {}, error: () => {} },
				timer,
				clock,
			},
		);
		void daemon.run();
		coordinator = session();
		remote = new RemoteWorker("local", {}, coordinator);
		await accept();
		before = remote.start(["claude"], "/repo");
		await Bun.sleep(0);
		child = ps.getChildren()[0];
	});

	/** A coordinator session as `arbor dev` makes one: named, acking by hand. */
	const session = () =>
		new WorkerSession("coordinator", {
			id: "coordinator-1",
			acks: "manual",
			timer,
			clock,
		});

	const accept = async () => {
		coordinator.accept(
			pair.coordinator,
			await WorkerSession.hello(pair.coordinator),
		);
		await Bun.sleep(0);
	};

	/** The coordinator dies, and one with the same id comes up on a new link, which the worker redials. */
	const restart = async () => {
		coordinator.detach();
		pair.drop();
		coordinator = session();
		remote = new RemoteWorker("local", {}, coordinator);
		pair = new WorkerSocketPair();
		await Bun.sleep(0);
		timer.fireTimeouts();
	};

	/** Every frame `output` yields as it comes, as text with its seq. */
	const heard = (output: ReadableStream<AgentFrame>) => {
		const frames: [string, number][] = [];
		void (async () => {
			for await (const { bytes, seq } of output) {
				frames.push([new TextDecoder().decode(bytes), seq]);
			}
		})();
		return frames;
	};

	it("takes a process back, replaying from past what was written down, and learns its pid again", async () => {
		const frames = heard(before.output);
		child?.print("one\n");
		await eventually(() => frames.length === 1);
		before.ack(frames[0]?.[1] ?? 0);
		timer.fireTimeouts();
		await Bun.sleep(0);
		child?.print("two\n");
		await eventually(() => frames.length === 2);
		expect(before.pid).toBe(child?.pid ?? null);

		await restart();
		const after = remote.resume(before.handle, frames[0]?.[1] ?? null);
		const replayed = heard(after.output);
		await accept();
		await eventually(() => after.pid !== null);

		expect(after.handle).toEqual(before.handle);
		expect(replayed).toEqual([["two\n", frames[1]?.[1] ?? 0]]);
		expect(after.pid).toBe(child?.pid ?? null);
		expect(child?.signals).toEqual([]);
	});

	it("kills a process nobody took back", async () => {
		await eventually(() => before.pid !== null);

		await restart();
		await accept();
		await eventually(() => (child?.signals.length ?? 0) > 0);

		expect(child?.signals).toEqual(["SIGTERM"]);
	});

	it("refuses a process of another worker's", () => {
		expect(() => remote.resume({ worker: "mac", channel: 2 }, null)).toThrow(
			"runs on worker mac",
		);
	});
});
