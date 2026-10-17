import { beforeEach, describe, expect, it } from "bun:test";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import type { WorkerChannel } from "./worker-channel";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("WorkerSession resumed by a coordinator started again", () => {
	let timer: FakeTimer;
	let clock: FakeClock;
	let worker: WorkerSession;
	let coordinator: WorkerSession;
	let pair: WorkerSocketPair;
	/** The channels the worker was opened, in order. */
	let opened: WorkerChannel[];
	/** A pty open before the restart, as channel 2; the worker's end is `opened[0]`. */
	let shell: WorkerChannel;

	beforeEach(async () => {
		timer = new FakeTimer();
		clock = new FakeClock();
		pair = new WorkerSocketPair();
		worker = new WorkerSession("worker", { timer, clock });
		coordinator = new WorkerSession("coordinator", {
			id: "coordinator-1",
			acks: "manual",
			timer,
			clock,
		});
		opened = [];
		worker.events.on("channel", (channel) => opened.push(channel));
		await link(worker, coordinator, pair);
		shell = coordinator.open("pty");
		await Bun.sleep(0);
	});

	/** The coordinator dies mid-stream, and one answering as it comes up. */
	const restarted = () => {
		coordinator.detach();
		pair.drop();
		return new WorkerSession("coordinator", {
			id: "coordinator-1",
			acks: "manual",
			timer,
			clock,
		});
	};

	/** Links `next` to the worker over a new connection, as the worker redialing does. */
	const relink = (next: WorkerSession) => {
		pair = new WorkerSocketPair();
		return link(worker, next, pair);
	};

	it("keeps the worker's channels, replaying each from what the log held", async () => {
		const claude = coordinator.open("process", { argv: ["claude"] });
		let logged: WorkerChannel | undefined;
		claude.events.on("data", ({ seq }) => {
			logged = claude;
			claude.ack(Math.min(seq, 2));
		});
		await Bun.sleep(0);
		opened[1]?.write(bytes("a"));
		opened[1]?.write(bytes("b"));
		await Bun.sleep(0);
		timer.fireTimeouts();
		await Bun.sleep(0);
		opened[1]?.write(bytes("c"));
		await Bun.sleep(0);
		expect(logged).toBe(claude);

		const next = restarted();
		const taken = next.resume(4, "process", { argv: ["claude"] }, 2);
		const heard: [string, number][] = [];
		taken.events.on("data", ({ bytes, seq }) =>
			heard.push([new TextDecoder().decode(bytes), seq]),
		);
		await relink(next);
		opened[1]?.write(bytes("d"));
		await Bun.sleep(0);

		expect(heard).toEqual([
			["c", 3],
			["d", 4],
		]);
		expect(opened.map(({ closed }) => closed)).toEqual([true, false]);
	});

	it("sends on a channel taken back from past what the worker received, and opens new ones past it", async () => {
		const typed: string[] = [];
		opened[0]?.events.on("data", ({ bytes }) =>
			typed.push(new TextDecoder().decode(bytes)),
		);
		shell.write(bytes("ls\n"));
		await Bun.sleep(0);

		const next = restarted();
		const taken = next.resume(2, "pty", null, null);
		await relink(next);
		taken.write(bytes("pwd\n"));
		const codex = next.open("process", { argv: ["codex"] });
		await Bun.sleep(0);

		expect(typed).toEqual(["ls\n", "pwd\n"]);
		expect(codex.id).toBe(4);
		expect(opened.map(({ id, closed }) => [id, closed])).toEqual([
			[2, false],
			[4, false],
		]);
	});

	it("takes a channel back blind, hearing the replay from wherever it starts", async () => {
		shell.events.on("data", ({ seq }) => shell.ack(seq));
		opened[0]?.write(bytes("one"));
		await Bun.sleep(0);
		timer.fireTimeouts();
		await Bun.sleep(0);
		opened[0]?.write(bytes("two"));
		await Bun.sleep(0);

		const next = restarted();
		const taken = next.resume(2, "pty", null, null);
		const heard: string[] = [];
		taken.events.on("data", ({ bytes }) =>
			heard.push(new TextDecoder().decode(bytes)),
		);
		await relink(next);
		await Bun.sleep(0);

		expect(heard).toEqual(["two"]);
	});

	it("closes the channels nobody took back, which ends what they ran", async () => {
		coordinator.open("process", { argv: ["claude"] });
		await Bun.sleep(0);

		const next = restarted();
		next.resume(2, "pty", null, null);
		await relink(next);
		await Bun.sleep(0);

		expect(opened.map(({ id, closed }) => [id, closed])).toEqual([
			[2, false],
			[4, true],
		]);
	});

	it("settles acked once the worker holds everything sent", async () => {
		shell.write(bytes("ls\n"));
		let settled = false;
		void coordinator.acked().then(() => {
			settled = true;
		});
		await Bun.sleep(0);
		expect(settled).toBe(false);
		timer.fireTimeouts();
		await Bun.sleep(0);
		await Bun.sleep(0);

		expect(settled).toBe(true);
		await expect(coordinator.acked()).resolves.toBeUndefined();
	});
});

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
