import { beforeEach, describe, expect, it } from "bun:test";
import type { SpawnOptions } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
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
});
