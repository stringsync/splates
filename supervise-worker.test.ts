import { beforeEach, describe, expect, it } from "bun:test";
import type { SpawnOptions } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { supervise, UPDATE } from "./supervise";

describe("supervise with a worker", () => {
	let ps: FakePs;
	let timer: FakeTimer;
	let servers: ((code: number) => void)[];
	let workers: { argv: string; end(code: number): void; aborted: boolean }[];

	beforeEach(() => {
		ps = new FakePs();
		ps.args = ["dev"];
		timer = new FakeTimer();
		servers = [];
		workers = [];
		// Children that end when the test says, a worker's also when aborted.
		ps.spawn = (argv: string[], opts?: SpawnOptions) =>
			new Promise((resolve, reject) => {
				const abort = new AbortController();
				const end = (exitCode: number) => {
					abort.abort();
					resolve({ exitCode });
				};
				const worker = { argv: argv.join(" "), end, aborted: false };
				opts?.signal?.addEventListener(
					"abort",
					() => {
						worker.aborted = true;
						reject(new Error("aborted"));
					},
					{ signal: abort.signal },
				);
				if (argv.includes("worker")) {
					workers.push(worker);
				} else {
					servers.push(end);
				}
			});
	});

	it("runs a worker beside the server, again a pause after it ends, on the newest arbor once updated, until the server ends", async () => {
		const ended = supervise(ps, { worker: ["worker", "run"], timer });
		await Bun.sleep(0);
		servers[0]?.(UPDATE);
		workers[0]?.end(1);
		await Bun.sleep(0);
		timer.fireTimeouts();
		await Bun.sleep(0);
		servers[1]?.(0);

		expect(await ended).toBe(0);
		expect(workers.map(({ argv, aborted }) => [argv, aborted])).toEqual([
			["bun /fake/entry.ts worker run", false],
			["bunx @webappwiz/arbor@latest worker run", true],
		]);
	});

	it("leaves a worker running while the server restarts", async () => {
		const ended = supervise(ps, { worker: ["worker", "run"], timer });
		await Bun.sleep(0);
		servers[0]?.(75);
		await Bun.sleep(0);
		servers[1]?.(0);

		expect(await ended).toBe(0);
		expect(workers.map(({ aborted }) => aborted)).toEqual([true]);
	});
});
