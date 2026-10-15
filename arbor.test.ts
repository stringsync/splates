import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { basename, join } from "node:path";
import { arbor } from "./arbor";
import { SERVING } from "./supervise";
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
			secrets: env.secrets,
			fetch: Object.assign(
				() => Promise.reject(new Error("no network in a test")),
				{ preconnect: () => {} },
			),
		};
	});

	afterEach(() => env.disposeAsync());

	it("runs its commands against the dependencies it is given", async () => {
		await arbor.run(deps, ["add", "alpha", "--goal", "land it"]);
		await arbor.run(deps, ["list", "--json"]);

		const rows = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(rows).toMatchObject([{ task: "alpha", status: "working" }]);
		expect(await env.fs.exists(join(`${env.root}-arbor.noindex`, "alpha"))).toBe(true);
	});

	it("prints the roster from outside any repository", async () => {
		const away = join(env.arborHome, "..");
		await env.fs.mkdir(away);
		env.ps.cd(away);
		await arbor.run(deps, ["agents", "--json"]);

		const roster = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(roster.map((agent: { id: string }) => agent.id)).toEqual([
			"claude",
			"codex",
		]);
		expect(await env.fs.exists(join(env.arborHome, "agents.json"))).toBe(true);
	});

	it("escalates a task and edits its todos", async () => {
		await arbor.run(deps, ["add", "alpha", "--goal", "land it"]);
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
		await arbor.run(deps, ["add", "alpha", "--goal", "land it"]);
		const worktree = await env.service.find("alpha");
		await env.finish(worktree.path);
		const plan = await env.fs.read(join(worktree.path, "ARBOR.md"));

		await arbor.run(deps, [
			"escalate",
			"check the header",
			"--task",
			"alpha",
			"--review",
		]);

		expect(
			(await env.service.find("alpha")).state?.escalations?.at(-1),
		).toMatchObject({ reason: "check the header", review: true });
		// A review is a state, not a question.
		expect(await env.fs.read(join(worktree.path, "ARBOR.md"))).toBe(plan);
	});

	it("reports a refusal as a reason, a message and an exit code", async () => {
		await arbor.run(deps, ["claim", "nope"]);

		expect(env.out()).toContain('"reason":"not_found"');
		expect(env.proc.lastExit()).toBe(8);
	});

	it("refuses a task with no Goal, and writes the one it is given into its plan", async () => {
		await arbor.run(deps, ["add", "alpha"]);

		expect(env.out()).toContain('"reason":"usage"');
		expect(env.out()).toContain("--goal");
		expect((await env.service.find("alpha")).gone).toBe(true);

		await arbor.run(deps, ["add", "alpha", "--goal", "Stop the 413 retries."]);
		const { path } = await env.service.find("alpha");
		expect(await env.fs.read(join(path, "ARBOR.md"))).toContain(
			"## Goal\n\nStop the 413 retries.",
		);
		expect((await env.journal.tail(1))[0]).toMatchObject({
			action: "add",
			goal: "Stop the 413 retries.",
		});
	});

	it("logs the todo it adds, with where it went", async () => {
		await arbor.run(deps, ["todo", "add", "first"]);
		await arbor.run(deps, [
			"todo",
			"add",
			"Upload retries forever on a 413",
			"--position",
			"1",
			"--lane",
			"new",
		]);

		expect((await env.journal.tail(1))[0]).toMatchObject({
			action: "todo add",
			reason: null,
			todo: 2,
			subject: "Upload retries forever on a 413",
			lane: 1,
			position: 1,
		});
	});

	it("logs the agent a handoff went to, and whether it answers back", async () => {
		env.proc.env.ARBOR_CONVERSATION = "c1";
		await arbor.run(deps, ["add", "alpha", "--goal", "Style it."]);
		await arbor.run(deps, ["handoff", "alpha", "--agent", "nobody"]);

		expect((await env.journal.tail(1))[0]).toMatchObject({
			action: "handoff",
			task: "alpha",
			reason: "usage",
		});
	});

	it("refuses a port that cannot exist rather than trying to listen", async () => {
		// As the supervisor runs it.
		env.proc.env[SERVING] = "1";
		await arbor.run(deps, ["dev", "--port", "99999"]);

		expect(env.out()).not.toContain("  reply ");
		expect(env.proc.lastExit()).toBe(1);
	});

	it("says no tunnel is saved, and requests the token a setup needs", async () => {
		await arbor.run(deps, ["tunnel", "status"]);
		expect(env.out()).toContain("no tunnel saved");

		await arbor.run(deps, [
			"tunnel",
			"setup",
			"arbor.example.com",
			"--email",
			"me@example.com",
		]);
		expect(env.out()).toContain("requested on the Creds page");
		expect(env.proc.lastExit()).toBe(25);
		expect(await env.creds.requests()).toMatchObject([
			{ name: "ARBOR_CLOUDFLARE_API_TOKEN", scope: "device", status: "open" },
		]);
	});
});
