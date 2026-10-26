import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import type { SpawnOptions } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { supervise } from "./supervise";

describe("supervise, signalled", () => {
	let ps: FakePs;
	let stopped: boolean;
	beforeEach(() => {
		ps = new FakePs();
		stopped = false;
		const spawn = ps.spawn.bind(ps);
		ps.spawn = (argv: string[], opts?: SpawnOptions) => {
			void spawn(argv, opts);
			return new Promise((_, reject) => {
				opts?.signal?.addEventListener("abort", () => {
					stopped = true;
					reject(new Error("aborted"));
				});
			});
		};
	});

	it.each([
		["SIGTERM", 143],
		["SIGHUP", 129],
	])("is stopped, and supervise ends, on a %s", async (signal, code) => {
		const ended = supervise(ps);
		await Promise.resolve();
		ps.dispatch(signal);

		expect(await ended).toBe(code);
		expect(stopped).toBe(true);
	});
	it.each([false, true])(
		"cancels a pending child on Ctrl-C (build: %s)",
		async (building) => {
			const log = new MemoryLogger();
			const timer = new FakeTimer();
			const ended = supervise(ps, {
				log,
				timer,
				build: building ? { argv: ["bun", "install"], cwd: "/checkout" } : null,
			});
			await Promise.resolve();
			ps.dispatch("SIGINT");

			expect(await ended).toBe(130);
			expect(stopped).toBe(true);
			expect(ps.getCalls()).toHaveLength(1);
			expect(log.entries[0]?.message).toContain("Stopping splates server");
			timer.fireTimeouts();
			expect(ps.isExited()).toBe(false);
			expect(log.entries).toHaveLength(1);
		},
	);

	it.each([
		["deadline", false],
		["second press", false],
		["deadline", true],
		["second press", true],
	] as const)(
		"force-stops an unresponsive child on %s (build: %s)",
		async (how, building) => {
			const timer = new FakeTimer();
			const log = new MemoryLogger();
			ps.setProcesses([
				{ pid: 5001, ppid: ps.pid, pgid: 5001, tpgid: 0, command: "server" },
				{ pid: 5002, ppid: 5001, pgid: 5002, tpgid: 0, command: "build" },
				{ pid: 6000, ppid: 1, pgid: 6000, tpgid: 0, command: "other server" },
			]);
			const spawn = ps.spawn.bind(ps);
			ps.spawn = (argv, opts) => spawn(argv, { ...opts, signal: undefined });
			const ended = supervise(ps, {
				timer,
				log,
				build: building ? { argv: ["bun", "install"], cwd: "/checkout" } : null,
			});
			await Promise.resolve();
			// This child receives the stop but never settles its exit promise.
			// The force path must stop waiting as well as kill it.
			ps.dispatch("SIGINT");
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
});
