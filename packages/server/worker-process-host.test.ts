import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { eventually } from "./conversations/testing";
import type { WorkerChannel } from "./worker-channel";
import { descendants, WorkerProcessHost } from "./worker-process-host";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

describe("WorkerProcessHost", () => {
	let ps: FakePs;
	let timer: FakeTimer;
	let channel: WorkerChannel;
	let pid: number;
	let worker: WorkerSession;
	let coordinator: WorkerSession;

	beforeEach(async () => {
		timer = new FakeTimer();
		const clock = new FakeClock();
		ps = new FakePs();
		const pair = new WorkerSocketPair();
		worker = new WorkerSession("worker", { timer, clock });
		coordinator = new WorkerSession("coordinator", { timer, clock });
		worker.events.on(
			"channel",
			(channel) => new WorkerProcessHost(channel, worker, ps, { timer }),
		);
		const connecting = worker.connect(pair.worker, { id: "local" });
		coordinator.accept(
			pair.coordinator,
			await WorkerSession.hello(pair.coordinator),
		);
		await connecting;
		channel = coordinator.open("process", {
			argv: ["agent"],
			cwd: "/repo",
			env: {},
		});
		await eventually(() => ps.getChildren().length === 1);
		pid = ps.getChildren()[0]?.pid ?? 0;
	});

	afterEach(() => {
		worker.dispose();
		coordinator.dispose();
	});

	it("ends everything the process started when its channel closes, dev servers too", async () => {
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

	it("ends what an agent left running when it exits on its own", async () => {
		const child = ps.getChildren()[0];
		ps.setProcesses([
			row(1, 0),
			row(pid, 1),
			row(700, pid),
			row(701, 700, 701),
		]);
		timer.fireIntervals();
		await eventually(() => ps.getCalls().length === 1);
		// The agent dies; its commands are reparented to init, and a reused pid is not theirs.
		ps.setProcesses([row(1, 0), row(700, 1), row(701, 700, 701), row(900, 1)]);
		child?.exit(1);
		await eventually(() => ps.getCalls().length > 1);
		expect(ps.getCalls()).toEqual(["agent", "kill -TERM 700 701"]);
		channel.dispose();
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
