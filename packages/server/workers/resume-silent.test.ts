import { beforeEach, describe, expect, it } from "bun:test";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { ANSWER_WITHIN, type WorkerProcess } from "./process";
import { WorkerSession } from "./session";
import { WorkerSocketPair } from "./testing";
import { ConnectedWorker } from "./worker";

describe("A process taken back that its rejoined worker never answers for", () => {
	let timer: FakeTimer;
	let after: WorkerProcess;

	beforeEach(async () => {
		timer = new FakeTimer();
		const clock = new FakeClock();
		// A worker that holds the channel but serves nothing on it, as one
		// that lost the process in the restart without saying so.
		const worker = new WorkerSession("worker", { timer, clock });
		const coordinator = () =>
			new WorkerSession("coordinator", {
				id: "coordinator-1",
				acks: "manual",
				timer,
				clock,
			});
		const link = async (next: WorkerSession, pair: WorkerSocketPair) => {
			const connecting = worker.connect(pair.worker, { id: "local" });
			next.accept(
				pair.coordinator,
				await WorkerSession.hello(pair.coordinator),
			);
			await connecting;
		};
		const first = coordinator();
		const pair = new WorkerSocketPair();
		await link(first, pair);
		const before = new ConnectedWorker("local", {}, first).start(
			["claude"],
			"/repo",
		);
		await Bun.sleep(0);
		first.detach();
		pair.drop();
		await Bun.sleep(0);
		const next = coordinator();
		after = new ConnectedWorker("local", {}, next).resume(before.handle, null);
		await link(next, new WorkerSocketPair());
		await Bun.sleep(0);
	});

	it("ends as a lost process does once the bound is up, saying why", async () => {
		fireAnswerBound(timer);

		expect(await after.exited).toBe(127);
		expect(after.stderr()).toBe(
			`the worker did not answer for it within ${ANSWER_WITHIN.secs}s of rejoining`,
		);
	});
});

/** Fires each timeout of `ANSWER_WITHIN`, the bound on a worker's answer for a process taken back. */
function fireAnswerBound(timer: FakeTimer): void {
	timer.timeouts.forEach((entry, index) => {
		if (entry.delay.secs === ANSWER_WITHIN.secs) {
			timer.fireTimeout(index);
		}
	});
}
