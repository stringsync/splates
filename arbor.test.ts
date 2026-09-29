import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { arbor } from "./arbor";
import { Testing } from "./testing";

/**
 * The cli in this process, run with fakes: the same commands `e2e.test.ts`
 * spawns, minus the subprocess. What it proves is the wiring, that every
 * dependency an action uses arrives through `run`.
 */
describe("arbor cli", () => {
	it("runs its commands against the dependencies it is given", async () => {
		await using env = await Testing.open();
		env.ps.cd(env.root);
		const deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			assets: env.assets,
		};

		await arbor.run(deps, ["add", "alpha"]);
		await arbor.run(deps, ["list", "--json"]);

		const rows = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(rows).toMatchObject([{ task: "alpha", status: "working" }]);
		expect(await env.fs.exists(join(`${env.root}-arbor`, "alpha"))).toBe(true);
	});

	it("answers a question from the inbox and journals the reply", async () => {
		await using env = await Testing.open();
		env.ps.cd(env.root);
		const deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			assets: env.assets,
		};
		await arbor.run(deps, ["add", "alpha"]);
		const worktree = await (await env.service.find("alpha")).save({
			lease: null,
		});
		await env.fs.write(
			join(worktree.path, "ARBOR.md"),
			"# alpha\n\n## Blocked\n\n- [ ] Q1. [ui] Open it.\n- [ ] Q2. [db] Run it.\n",
		);
		await env.fs.write(join(env.root, "a.png"), "a");
		await env.fs.write(join(env.root, "b.png"), "b");

		await arbor.run(deps, ["inbox", "--tag", "db,css", "--json"]);
		const found = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(found.questions).toMatchObject([{ task: "alpha", number: "Q2" }]);

		await arbor.run(deps, [
			"reply",
			"alpha",
			"q1",
			"looks right",
			"--image",
			"a.png,b.png",
		]);
		const plan = await env.fs.read(join(worktree.path, "ARBOR.md"));
		expect(plan).toContain("- [ ] Q1. [ui] Open it. → looks right /");
		expect(plan).toContain("-b.png\n");

		await arbor.run(deps, ["log", "--json"]);
		const entries = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(entries.at(-1)).toMatchObject({
			action: "reply",
			task: "alpha",
			reason: null,
		});
	});

	it("reports a refusal as a reason, a message and an exit code", async () => {
		await using env = await Testing.open();
		env.ps.cd(env.root);

		await arbor.run(
			{
				log: env.log,
				fs: env.fs,
				ps: env.ps,
				assets: env.assets,
			},
			["claim", "nope"],
		);

		expect(env.out()).toContain('"reason":"not_found"');
		expect(env.proc.lastExit()).toBe(8);
	});

	it("refuses a port that cannot exist rather than trying to listen", async () => {
		await using env = await Testing.open();
		env.ps.cd(env.root);

		await arbor.run(
			{
				log: env.log,
				fs: env.fs,
				ps: env.ps,
				assets: env.assets,
			},
			["dev", "--port", "99999"],
		);

		expect(env.out()).toContain('"reason":"usage"');
		expect(env.proc.lastExit()).toBe(1);
	});
});
