import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "core/log";
import type { SpawnOptions } from "core/system";
import { FakePs } from "core/system/testing";
import { FakeTimer } from "core/time/testing";
import { supervise } from "./supervise";

describe("supervise, signalled", () => {
	let ps: FakePs;
	let stopped: boolean;
	let timer: FakeTimer;
	let log: MemoryLogger;
	beforeEach(() => {
		ps = new FakePs();
		timer = new FakeTimer();
		log = new MemoryLogger();
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
});
