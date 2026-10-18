import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { eventually } from "../conversations/testing";
import { WorkerProcessHost } from "./process-host";
import { WorkerSession } from "./session";
import { WorkerSocketPair } from "./testing";

describe("WorkerProcessHost in a sandbox", () => {
	let ps: FakePs;
	let worker: WorkerSession;
	let coordinator: WorkerSession;

	beforeEach(async () => {
		ps = new FakePs();
		const timer = new FakeTimer();
		const clock = new FakeClock();
		const pair = new WorkerSocketPair();
		worker = new WorkerSession("worker", { timer, clock });
		coordinator = new WorkerSession("coordinator", { timer, clock });
		worker.events.on(
			"channel",
			(channel) =>
				new WorkerProcessHost(channel, worker, ps, {
					sandbox: { wrap: (argv, cwd) => ["box", cwd, ...argv] },
				}),
		);
		const connecting = worker.connect(pair.worker, { id: "boxed" });
		coordinator.accept(
			pair.coordinator,
			await WorkerSession.hello(pair.coordinator),
		);
		await connecting;
	});

	afterEach(() => {
		worker.dispose();
		coordinator.dispose();
	});

	it("starts its process wrapped in the sandbox", async () => {
		coordinator.open("process", { argv: ["agent", "--acp"], cwd: "/repo" });
		await eventually(() => ps.getChildren().length === 1);
		expect(ps.getCalls()).toEqual(["box /repo agent --acp"]);
	});
});
