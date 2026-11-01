import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "core/log";
import { FakePs } from "core/system/testing";
import { FakeTimer } from "core/time/testing";
import { supervise } from "./supervise";

describe("supervise, forced", () => {
	let ps: FakePs;
	let timer: FakeTimer;
	let log: MemoryLogger;
	beforeEach(() => {
		ps = new FakePs();
		timer = new FakeTimer();
		log = new MemoryLogger();
		ps.setProcesses([
			{ pid: 5001, ppid: ps.pid, pgid: 5001, tpgid: 0, command: "server" },
			{ pid: 5002, ppid: 5001, pgid: 5002, tpgid: 0, command: "build" },
			{ pid: 6000, ppid: 1, pgid: 6000, tpgid: 0, command: "other server" },
		]);
		// This child receives the stop but never settles its exit promise.
		// The force path must stop waiting as well as kill it.
		const spawn = ps.spawn.bind(ps);
		ps.spawn = (argv, opts) => {
			void spawn(argv, opts);
			return new Promise(() => {});
		};
	});

	it.each([
		["deadline", false],
		["second press", false],
		["deadline", true],
		["second press", true],
	] as const)(
		"force-stops an unresponsive child on %s (build: %s)",
		async (how, building) => {
			const ended = supervise(ps, {
				timer,
				log,
				build: building ? { argv: ["bun", "install"], cwd: "/checkout" } : null,
			});
			await Promise.resolve();
			ps.dispatch("SIGINT");
			ps.kill(5001);
			ps.kill(5002);
			const force = {
				deadline: () => timer.fireTimeouts(),
				"second press": () => ps.dispatch("SIGINT"),
			};
			force[how]();

			expect(await ended).toBe(130);
			expect(ps.getExitCode()).toBe(130);
			expect(ps.getCalls()).toContain("kill -KILL 5001 5002");
			expect(log.entries.map((entry) => entry.message)).toContain(
				"Forcing splates server to stop.",
			);
		},
	);

	it("exits only once the children it killed are gone", async () => {
		const ended = supervise(ps, { timer, log, build: null });
		await Promise.resolve();
		ps.dispatch("SIGINT");
		ps.dispatch("SIGINT");
		await Bun.sleep(0);
		timer.fireTimeouts();
		await Bun.sleep(0);
		expect(ps.isExited()).toBe(false);

		ps.kill(5001);
		ps.kill(5002);
		timer.fireTimeouts();
		expect(await ended).toBe(130);
	});
});
