import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { basename, join } from "node:path";
import { arbor } from "./arbor";
import { Testing } from "./testing";

/**
 * The cli in this process, run with fakes: the same commands `e2e.test.ts`
 * spawns, minus the subprocess. What it proves is the wiring, that every
 * dependency an action uses arrives through `run`.
 */
describe("arbor cli", () => {
	let env: Testing;
	let deps: Parameters<typeof arbor.run>[0];

	beforeEach(async () => {
		env = await Testing.open();
		env.ps.cd(env.root);
		deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			assets: env.assets,
		};
	});

	afterEach(() => env.disposeAsync());

	it("runs its commands against the dependencies it is given", async () => {
		await arbor.run(deps, ["add", "alpha"]);
		await arbor.run(deps, ["list", "--json"]);

		const rows = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(rows).toMatchObject([{ task: "alpha", status: "working" }]);
		expect(await env.fs.exists(join(`${env.root}-arbor`, "alpha"))).toBe(true);
	});

	it("escalates a task and edits its todos", async () => {
		await arbor.run(deps, ["add", "alpha"]);
		const worktree = await env.service.find("alpha");
		await env.fs.write(
			join(worktree.path, "ARBOR.md"),
			"# alpha\n\n## Blocked\n\n- [ ] 1. Open it.\n",
		);
		await env.fs.write(join(env.root, "a.png"), "a");
		env.ps.cd(worktree.path);
		await arbor.run(deps, ["escalate", "needs a person"]);

		env.ps.cd(env.root);
		await arbor.run(deps, [
			"todo",
			"add",
			"write docs",
			"the CLI first",
			"--file",
			"a.png",
		]);
		const [attached = ""] = (await env.todos.find(1)).files;
		await arbor.run(deps, [
			"todo",
			"update",
			"1",
			"--subject",
			"write the docs",
			"--position",
			"1",
			"--remove-file",
			basename(attached),
		]);
		expect((await env.todos.find(1)).state).toMatchObject({
			subject: "write the docs",
			text: "the CLI first",
			position: 1,
			files: [],
		});

		await arbor.run(deps, ["log", "--json"]);
		const entries = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(entries.map((entry: { action: string }) => entry.action)).toContain(
			"escalate",
		);
	});

	it("asks for a review from the command line", async () => {
		await arbor.run(deps, ["add", "alpha"]);

		await arbor.run(deps, [
			"escalate",
			"check the header",
			"--task",
			"alpha",
			"--review",
		]);

		const worktree = await env.service.find("alpha");
		expect(worktree.state?.escalations?.at(-1)?.review).toBe("1");
		expect(await env.fs.read(join(worktree.path, "ARBOR.md"))).toContain(
			"- [ ] 1. Ready to merge?\n  check the header\n",
		);
	});

	it("reports a refusal as a reason, a message and an exit code", async () => {
		await arbor.run(deps, ["claim", "nope"]);

		expect(env.out()).toContain('"reason":"not_found"');
		expect(env.proc.lastExit()).toBe(8);
	});

	it("refuses a port that cannot exist rather than trying to listen", async () => {
		await arbor.run(deps, ["dev", "--port", "99999"]);

		expect(env.out()).not.toContain("  reply ");
		expect(env.proc.lastExit()).toBe(1);
	});
});
