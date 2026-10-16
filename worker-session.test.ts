import { beforeEach, describe, expect, it } from "bun:test";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import type { WorkerChannel } from "./worker-channel";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

const text = new TextEncoder();
const bytes = (value: string) => text.encode(value);

describe("WorkerSession", () => {
	let timer: FakeTimer;
	let worker: WorkerSession;
	let coordinator: WorkerSession;
	let opened: WorkerChannel[];
	let stdio: WorkerChannel;

	beforeEach(async () => {
		timer = new FakeTimer();
		const clock = new FakeClock();
		const pair = new WorkerSocketPair();
		worker = new WorkerSession("worker", { bufferBytes: 1024, timer, clock });
		coordinator = new WorkerSession("coordinator", { timer, clock });
		opened = [];
		worker.events.on("channel", (channel) => opened.push(channel));
		const connecting = worker.connect(pair.worker, { id: "mac" });
		coordinator.accept(
			pair.coordinator,
			await WorkerSession.hello(pair.coordinator),
		);
		await connecting;
		stdio = coordinator.open("process", { argv: ["claude"] });
		await Bun.sleep(0);
	});

	it("opens a channel at the other end with its kind and params", () => {
		expect(opened).toMatchObject([
			{ id: 2, kind: "process", params: { argv: ["claude"] } },
		]);
	});

	it("carries bytes and messages both ways on a channel", async () => {
		const output: string[] = [];
		const messages: unknown[] = [];
		stdio.events.on("data", (event) =>
			output.push(new TextDecoder().decode(event.bytes)),
		);
		stdio.events.on("message", (event) => messages.push(event.body));
		const typed: string[] = [];
		opened[0]?.events.on("data", (event) =>
			typed.push(new TextDecoder().decode(event.bytes)),
		);

		stdio.write(bytes("hi\n"));
		opened[0]?.write(bytes("hello"));
		opened[0]?.send({ exit: 0 });
		await Bun.sleep(0);

		expect(typed).toEqual(["hi\n"]);
		expect(output).toEqual(["hello"]);
		expect(messages).toEqual([{ exit: 0 }]);
	});

	it("says to stop writing once unacked bytes reach the bound, and drains on ack", async () => {
		const output = worker.open("process");
		const drained: unknown[] = [];
		worker.events.on("drain", () => drained.push("drain"));

		expect(output.write(new Uint8Array(100))).toBe(true);
		expect(output.write(new Uint8Array(1024))).toBe(false);
		expect(worker.writable).toBe(false);
		await Bun.sleep(0);
		timer.fireTimeouts();
		await Bun.sleep(0);

		expect(drained).toEqual(["drain"]);
		expect(worker.writable).toBe(true);
	});

	it("closes a channel at the other end when one end disposes it", async () => {
		const closes: unknown[] = [];
		opened[0]?.events.on("close", () => closes.push("close"));

		stdio.dispose();
		await Bun.sleep(0);

		expect(closes).toEqual(["close"]);
		expect(opened[0]?.closed).toBe(true);
		expect(() => opened[0]?.write(bytes("late"))).toThrow("is closed");
	});

	it("closes every channel at the other end when a session is disposed", async () => {
		coordinator.open("pty");
		await Bun.sleep(0);

		coordinator.dispose();
		await Bun.sleep(0);

		expect(opened.map((channel) => channel.closed)).toEqual([true, true]);
	});
});
