import { beforeEach, describe, expect, it } from "bun:test";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import type { WorkerChannel } from "./worker-channel";
import { WorkerProtocol } from "./worker-protocol";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

const text = new TextEncoder();
const bytes = (value: string) => text.encode(value);

describe("WorkerSession replay", () => {
	let timer: FakeTimer;
	let pair: WorkerSocketPair;
	let worker: WorkerSession;
	let coordinator: WorkerSession;

	beforeEach(async () => {
		timer = new FakeTimer();
		const clock = new FakeClock();
		pair = new WorkerSocketPair();
		worker = new WorkerSession("worker", { timer, clock });
		// Acks only what it says it holds, as a coordinator that logs first does.
		coordinator = new WorkerSession("coordinator", {
			acks: "manual",
			timer,
			clock,
		});
		await link(worker, coordinator, pair);
	});

	it("replays exactly the unacked frames on reconnect, in order, once", async () => {
		const heard: [string, number][] = [];
		let held: WorkerChannel | undefined;
		coordinator.events.on("channel", (channel) => {
			held = channel;
			channel.events.on("data", (event) =>
				heard.push([new TextDecoder().decode(event.bytes), event.seq]),
			);
		});
		const stdio = worker.open("process");
		stdio.write(bytes("a"));
		stdio.write(bytes("b"));
		await Bun.sleep(0);
		held?.ack(3);
		timer.fireTimeouts();
		stdio.write(bytes("c"));
		stdio.write(bytes("d"));
		await Bun.sleep(0);
		stdio.write(bytes("e"));
		pair.drop();
		stdio.write(bytes("f"));
		await Bun.sleep(0);

		pair = new WorkerSocketPair();
		const replayed: unknown[] = [];
		pair.coordinator.events.on("frame", (frame) =>
			replayed.push(WorkerProtocol.decode(frame)),
		);
		await link(worker, coordinator, pair);
		await Bun.sleep(0);

		expect(replayed).toMatchObject([
			{ type: "hello", held: [] },
			{ type: "data", seq: 4 },
			{ type: "data", seq: 5 },
			{ type: "data", seq: 6 },
			{ type: "data", seq: 7 },
		]);
		expect(heard).toEqual([
			["a", 2],
			["b", 3],
			["c", 4],
			["d", 5],
			["e", 6],
			["f", 7],
		]);
	});

	it("delivers what the coordinator sent while the worker was away once it is back", async () => {
		const typed: string[] = [];
		worker.events.on("channel", (channel) =>
			channel.events.on("data", (event) =>
				typed.push(new TextDecoder().decode(event.bytes)),
			),
		);
		const pty = coordinator.open("pty");
		await Bun.sleep(0);
		pair.drop();
		await Bun.sleep(0);
		pty.write(bytes("ls\n"));

		pair = new WorkerSocketPair();
		await link(worker, coordinator, pair);
		await Bun.sleep(0);

		expect(typed).toEqual(["ls\n"]);
	});

	it("still holds a closed channel's seq across a reconnect before any pong", async () => {
		coordinator.open("process").dispose();
		await Bun.sleep(0);
		pair.drop();
		await Bun.sleep(0);

		pair = new WorkerSocketPair();
		const connecting = worker.connect(pair.worker, { id: "mac" });
		const hello = await WorkerSession.hello(pair.coordinator);
		coordinator.accept(pair.coordinator, hello);
		await connecting;

		expect(hello.held).toEqual([[2, 2]]);
	});

	it("forgets a closed channel once a pong proves the other end has its ack", async () => {
		coordinator.open("process").dispose();
		await Bun.sleep(0);
		timer.fireTimeouts();
		await Bun.sleep(0);
		timer.fireIntervals();
		await Bun.sleep(0);
		timer.fireIntervals();
		await Bun.sleep(0);
		pair.drop();
		await Bun.sleep(0);

		pair = new WorkerSocketPair();
		const connecting = worker.connect(pair.worker, { id: "mac" });
		const hello = await WorkerSession.hello(pair.coordinator);
		coordinator.accept(pair.coordinator, hello);
		await connecting;

		expect(hello.held).toEqual([]);
	});
});

/** A worker's connect and a coordinator's accept over `pair`, as a handshake. */
async function link(
	worker: WorkerSession,
	coordinator: WorkerSession,
	pair: WorkerSocketPair,
) {
	const connecting = worker.connect(pair.worker, { id: "mac" });
	coordinator.accept(
		pair.coordinator,
		await WorkerSession.hello(pair.coordinator),
	);
	return connecting;
}
