import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { eventually } from "./conversation-testing";
import { descendants, WorkerProcessHost } from "./worker-process-host";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

describe("WorkerProcessHost", () => {
	let ps: FakePs;
	let worker: WorkerSession;
	let coordinator: WorkerSession;

	beforeEach(async () => {
		const timer = new FakeTimer();
		const clock = new FakeClock();
		ps = new FakePs();
		const pair = new WorkerSocketPair();
		worker = new WorkerSession("worker", { timer, clock });
		coordinator = new WorkerSession("coordinator", { timer, clock });
		worker.events.on(
			"channel",
			(channel) => new WorkerProcessHost(channel, worker, ps),
		);
		const connecting = worker.connect(pair.worker, { id: "local" });
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

	it("ends everything the process started when its channel closes, dev servers too", async () => {
		const channel = coordinator.open("process", {
			argv: ["agent"],
			cwd: "/repo",
			env: {},
		});
		await eventually(() => ps.getChildren().length === 1);
		const pid = ps.getChildren()[0]?.pid ?? 0;
		ps.setProcesses([
			row(1, 0),
			row(pid, 1),
			row(700, pid),
			row(701, 700, 701),
			row(900, 1),
		]);
		channel.dispose();
		await eventually(() => ps.getCalls().length > 1);
		expect(ps.getCalls()).toEqual(["agent", "kill -TERM 700 701"]);
	});

	it("finds every process under one, whatever its group", () => {
		expect(
			descendants(
				[row(1, 0), row(10, 1), row(11, 10, 11), row(12, 11), row(20, 1)],
				10,
			),
		).toEqual([11, 12]);
	});
});

/** A row of the process table, under `ppid`. */
function row(pid: number, ppid: number, pgid = pid) {
	return { pid, ppid, pgid, tpgid: 0, command: `p${pid}` };
}
