import { describe, expect, it } from "bun:test";
import { basename, join } from "node:path";
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
			"# alpha\n\n## Blocked\n\n- [ ] Q1. Open it.\n- [ ] Q2. Run it where?\n  - [a] locally\n  - [b] in ci\n",
		);
		await env.fs.write(join(env.root, "a.png"), "a");
		await env.fs.write(join(env.root, "b.log"), "b");

		await arbor.run(deps, ["inbox", "--json"]);
		const found = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(found.questions).toMatchObject([
			{ task: "alpha", number: "Q1" },
			{ task: "alpha", number: "Q2", pick: "any" },
		]);

		await arbor.run(deps, [
			"reply",
			"alpha",
			"q1",
			"looks right",
			"--file",
			"a.png,b.log",
		]);
		// Waiting for its agent, not in the plan yet.
		expect(await env.fs.read(join(worktree.path, "ARBOR.md"))).not.toContain(
			"→",
		);

		await arbor.run(deps, ["reply", "alpha", "Q2", "--choice", "b,a"]);
		await arbor.run(deps, ["unreply", "alpha", "Q2"]);
		expect(await env.replies.find("alpha", "Q2")).toBeNull();
		await arbor.run(deps, ["todo", "add", "write docs", "--file", "a.png"]);
		const [attached = ""] = (await env.todos.find(1)).files;
		await arbor.run(deps, [
			"todo",
			"update",
			"1",
			"write the docs",
			"--remove-file",
			basename(attached),
		]);
		expect((await env.todos.find(1)).state).toMatchObject({
			text: "write the docs",
			files: [],
		});
		await arbor.run(deps, ["reply", "alpha", "Q2", "--choice", "b,a"]);

		await arbor.run(deps, ["inbox", "--replied", "--json"]);
		expect(
			JSON.parse(String(env.log.entries.at(-1)?.message)).questions,
		).toMatchObject([
			{ number: "Q1", state: "replied" },
			{ number: "Q2", state: "replied" },
		]);

		// The agent reads its replies from its tree, claiming them.
		env.ps.cd(worktree.path);
		await arbor.run(deps, ["replies"]);
		const plan = await env.fs.read(join(worktree.path, "ARBOR.md"));
		expect(plan).toContain("- [ ] Q1. Open it. → looks right /");
		expect(plan).toContain("-b.log\n");
		expect(plan).toContain("Run it where? → a (locally), b (in ci)\n");
		env.log.clear();
		await arbor.run(deps, ["unreply", "alpha", "Q2"]);
		expect(env.out()).toContain('"reason":"exists"');

		await arbor.run(deps, ["log", "--json"]);
		const entries = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(entries.slice(-3)).toMatchObject([
			{ action: "reply", task: "alpha", reason: null },
			{ action: "replies", task: "alpha", reason: null },
			{ action: "unreply", task: "alpha", reason: "exists" },
		]);
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
