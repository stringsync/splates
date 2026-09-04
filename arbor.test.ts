import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { arbor } from "./arbor";
import { repo } from "./testing";

/**
 * The cli in this process, run with fakes: the same commands `e2e.test.ts`
 * spawns, minus the subprocess. What it proves is the wiring, that every
 * dependency an action uses arrives through `run`.
 */
describe("arbor cli", () => {
	it("runs its commands against the dependencies it is given", async () => {
		await using env = await repo();
		env.ps.cd(env.root);
		const deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			http: env.http,
			assets: env.assets,
		};

		await arbor.run(deps, ["add", "alpha"]);
		await arbor.run(deps, ["list", "--json"]);

		const rows = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(rows).toMatchObject([{ task: "alpha", status: "working" }]);
		expect(await env.fs.exists(join(`${env.root}-arbor`, "alpha"))).toBe(true);
	});

	it("reports a refusal as a reason, a message and an exit code", async () => {
		await using env = await repo();
		env.ps.cd(env.root);

		await arbor.run(
			{
				log: env.log,
				fs: env.fs,
				ps: env.ps,
				http: env.http,
				assets: env.assets,
			},
			["claim", "nope"],
		);

		expect(env.out()).toContain('"reason":"not_found"');
		expect(env.proc.lastExit()).toBe(8);
	});

	it("refuses a port that cannot exist rather than trying to listen", async () => {
		await using env = await repo();
		env.ps.cd(env.root);

		await arbor.run(
			{
				log: env.log,
				fs: env.fs,
				ps: env.ps,
				http: env.http,
				assets: env.assets,
			},
			["dev", "--port", "99999"],
		);

		expect(env.out()).toContain('"reason":"usage"');
		expect(env.proc.lastExit()).toBe(1);
	});
});
