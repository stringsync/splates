import { describe, expect, it } from "bun:test";
import { basename, join } from "node:path";
import { arbor } from "./arbor";
import { replyTo } from "./reply";
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

	it("lets an agent wait for what the page answered, and nothing more", async () => {
		await using env = await Testing.open();
		env.ps.cd(env.root);
		const deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			assets: env.assets,
		};
		await arbor.run(deps, ["add", "alpha"]);
		const worktree = await env.service.find("alpha");
		await env.fs.write(
			join(worktree.path, "ARBOR.md"),
			"# alpha\n\n## Blocked\n\n- [ ] 1. Open it.\n- [ ] 2. Run it where?\n  - [a] locally\n  - [b] in ci\n",
		);
		await env.fs.write(join(env.root, "a.png"), "a");
		env.ps.cd(worktree.path);
		await arbor.run(deps, ["escalate", "needs a person"]);

		// A person answers from the page; the CLI has no way to.
		env.log.clear();
		await arbor.run(deps, ["reply", "alpha", "1", "looks right"]);
		expect(env.out()).not.toContain("  reply ");
		await replyTo(env, "alpha", "1", { text: "looks right" });
		await replyTo(env, "alpha", "2", { text: "", choices: ["b", "a"] });

		// The agent waits for its answers and reads them in its plan.
		env.log.clear();
		await arbor.run(deps, ["wait", "alpha", "--answered"]);
		expect(env.out()).toContain("    → a (locally), b (in ci)");
		const plan = await env.fs.read(join(worktree.path, "ARBOR.md"));
		expect(plan).toContain("Run it where? → a (locally), b (in ci)\n");

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
		await using env = await Testing.open();
		env.ps.cd(env.root);
		const deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			assets: env.assets,
		};
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
			"- [ ] 1. ✅ Ready to merge?\n  check the header\n",
		);
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

		expect(env.out()).not.toContain("  reply ");
		expect(env.proc.lastExit()).toBe(1);
	});
});
