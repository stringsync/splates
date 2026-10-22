import { beforeEach, describe, expect, it } from "bun:test";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import type { WorkerChannel } from "./channel";
import { WorkerSession } from "./session";
import { WorkerSocketPair } from "./testing";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("WorkerSession resumed by a coordinator started again", () => {
	let timer: FakeTimer;
	let clock: FakeClock;
	let worker: WorkerSession;
	let coordinator: WorkerSession;
	let pair: WorkerSocketPair;
	/** The channels the worker was opened, in order. */
	let opened: WorkerChannel[];
	/** What reached the worker, as each channel's id and its text, in order. */
	let reached: [number, string][];
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
		reached = [];
		worker.events.on("channel", (channel) => {
			opened.push(channel);
			channel.events.on("data", ({ bytes }) =>
				reached.push([channel.id, new TextDecoder().decode(bytes)]),
			);
		});
		await link(worker, coordinator, pair);
		shell = coordinator.open("pty");
		await Bun.sleep(0);
	});

	/** The server dies mid-stream, and one answering as it comes up. */
	const restarted = (resumedProtocol?: string) => {
		coordinator.detach();
		pair.drop();
		return new WorkerSession("coordinator", {
			id: "coordinator-1",
			...(resumedProtocol === undefined ? {} : { resumedProtocol }),
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

	/**
	 * The server started again, taking the shell back, and the worker
	 * rejoined it, with each hang-up the new session made since.
	 */
	const rejoined = async () => {
		const next = restarted();
		next.resume(2, "pty", null, null);
		const lost: string[] = [];
		next.events.on("lost", ({ reason }) => lost.push(reason));
		await relink(next);
		await Bun.sleep(0);
		timer.fireTimeouts();
		await Bun.sleep(0);
		return { next, lost };
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

	it("opens a channel before the worker rejoins on an id past the one it takes back", async () => {
		const next = restarted();
		const taken = next.resume(2, "pty", null, null);
		const heard: string[] = [];
		taken.events.on("data", ({ bytes }) =>
			heard.push(new TextDecoder().decode(bytes)),
		);
		const claude = next.open("process", { argv: ["claude"] });
		claude.write(bytes("initialize"));
		await relink(next);
		taken.write(bytes("pwd\n"));
		opened[0]?.write(bytes("~\n"));
		await Bun.sleep(0);

		expect(claude.id).toBe(6);
		expect(reached).toEqual([
			[6, "initialize"],
			[2, "pwd\n"],
		]);
		expect(heard).toEqual(["~\n"]);
	});

	it("opens a channel before the worker rejoins on an id past every one the worker holds", async () => {
		coordinator.open("process", { argv: ["claude"] });
		await Bun.sleep(0);

		// This run takes back the shell on 2, not the agent on 4, and starts
		// another agent before the worker's handshake says it holds 4.
		const next = restarted();
		next.resume(2, "pty", null, null);
		const codex = next.open("process", { argv: ["codex"] });
		codex.write(bytes("initialize"));
		await relink(next);
		await Bun.sleep(0);

		expect(codex.id).toBe(6);
		expect(reached).toEqual([[6, "initialize"]]);
		expect(
			opened.map(({ id, params, closed }) => [id, params, closed]),
		).toEqual([
			[2, null, false],
			[4, { argv: ["claude"] }, true],
			[6, { argv: ["codex"] }, false],
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

	it("stays joined to a worker replaying a channel it opened that the coordinator never answered", async () => {
		// An agent's `splates` call through the worker's relay, its open acked
		// but nothing yet said back when the server went.
		coordinator.events.on("channel", (channel) =>
			channel.events.on("data", () => {}),
		);
		const relay = worker.open("relay");
		relay.write(bytes("GET /api/tasks"));
		await Bun.sleep(0);
		timer.fireTimeouts();
		await Bun.sleep(0);
		relay.write(bytes("more"));
		await Bun.sleep(0);

		const { lost, next } = await rejoined();

		expect(lost).toEqual([]);
		expect(next.connected).toBe(true);
		// Nobody here will answer it, so the worker hears it close.
		expect(relay.closed).toBe(true);
		expect(opened.map(({ closed }) => closed)).toEqual([false]);
	});

	it("stays joined to a worker replaying the open of a channel the coordinator answered before acking it", async () => {
		// The server acks an open a moment after it, and its relay can
		// answer first.
		coordinator.events.on("channel", (channel) =>
			channel.send({ type: "connected" }),
		);
		const relay = worker.open("relay");
		await Bun.sleep(0);

		const { lost, next } = await rejoined();

		expect(lost).toEqual([]);
		expect(next.connected).toBe(true);
		expect(relay.closed).toBe(true);
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

	it("takes no channel back from a session of another protocol major", async () => {
		const next = restarted("0.9");
		next.resume(2, "pty", null, null);
		await relink(next);

		expect(opened.map(({ closed }) => closed)).toEqual([true]);
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
