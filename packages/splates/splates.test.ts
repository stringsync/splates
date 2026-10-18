import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { basename, join } from "node:path";
import { SERVING } from "@stringsync/splates-server/server";
import { Testing } from "@stringsync/splates-server/testing";
import { splates } from "./splates";

/**
 * The cli in this process, run with fakes: the same commands `e2e.test.ts`
 * spawns, minus the subprocess. What it proves is the wiring, that every
 * dependency an action uses arrives through `run`.
 */
describe("splates cli", () => {
	let env: Testing;
	let deps: Parameters<typeof splates.run>[0];

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
		await splates.run(deps, ["add", "alpha", "--goal", "land it"]);
		await splates.run(deps, ["list", "--json"]);

		const rows = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(rows).toMatchObject([{ task: "alpha", status: "working" }]);
		expect(
			await env.fs.exists(join(`${env.root}-splates.noindex`, "alpha")),
		).toBe(true);
	});

	it("prints the roster from outside any repository", async () => {
		const away = join(env.splatesHome, "..");
		await env.fs.mkdir(away);
		env.ps.cd(away);
		await splates.run(deps, ["agents", "--json"]);

		const roster = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(roster.map((agent: { id: string }) => agent.id)).toEqual([
			"claude",
			"codex",
		]);
		expect(await env.fs.exists(join(env.splatesHome, "agents.json"))).toBe(
			true,
		);
	});

	it("prints setup's progress and skips a step from outside any repository", async () => {
		const away = join(env.splatesHome, "..");
		await env.fs.mkdir(away);
		env.ps.cd(away);
		await splates.run(deps, ["setup", "dictation", "--skip"]);
		await splates.run(deps, ["setup", "--json"]);

		const progress = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(progress.next).toBe("opencode-install");
		expect(
			progress.areas.find((area: { id: string }) => area.id === "dictation")
				.skipped,
		).toBe(1);
	});

	it("escalates a task and edits its todos", async () => {
		await splates.run(deps, ["add", "alpha", "--goal", "land it"]);
		const worktree = await env.service.find("alpha");
		await env.fs.write(
			join(worktree.path, "SPLATES.md"),
			"# alpha\n\n## Blocked\n\n- [ ] 1. Open it.\n",
		);
		await env.fs.write(join(env.root, "a.png"), "a");
		env.ps.cd(worktree.path);
		await splates.run(deps, ["escalate", "needs a person"]);

		env.ps.cd(env.root);
		await splates.run(deps, [
			"todo",
			"add",
			"write docs",
			"the CLI first",
			"--file",
			"a.png",
		]);
		const [attached = ""] = (await env.todos.find(1)).files;
		await splates.run(deps, [
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

		await splates.run(deps, ["log", "--json"]);
		const entries = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(entries.map((entry: { action: string }) => entry.action)).toContain(
			"escalate",
		);
	});

	it("asks for a review from the command line", async () => {
		await splates.run(deps, ["add", "alpha", "--goal", "land it"]);
		const worktree = await env.service.find("alpha");
		await env.finish(worktree.path);
		const plan = await env.fs.read(join(worktree.path, "SPLATES.md"));

		await splates.run(deps, [
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
		expect(await env.fs.read(join(worktree.path, "SPLATES.md"))).toBe(plan);
	});

	it("reports a refusal as a reason, a message and an exit code", async () => {
		await splates.run(deps, ["claim", "nope"]);

		expect(env.out()).toContain('"reason":"not_found"');
		expect(env.proc.lastExit()).toBe(8);
	});

	it("refuses a task with no Goal, and writes the one it is given into its plan", async () => {
		await splates.run(deps, ["add", "alpha"]);

		expect(env.out()).toContain('"reason":"usage"');
		expect(env.out()).toContain("--goal");
		expect((await env.service.find("alpha")).gone).toBe(true);

		await splates.run(deps, [
			"add",
			"alpha",
			"--goal",
			"Stop the 413 retries.",
		]);
		const { path } = await env.service.find("alpha");
		expect(await env.fs.read(join(path, "SPLATES.md"))).toContain(
			"## Goal\n\nStop the 413 retries.",
		);
		expect((await env.journal.tail(1))[0]).toMatchObject({
			action: "add",
			goal: "Stop the 413 retries.",
		});
	});

	it("logs the todo it adds, with where it went", async () => {
		await splates.run(deps, ["todo", "add", "first"]);
		await splates.run(deps, [
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
		env.proc.env.SPLATES_CONVERSATION = "c1";
		await splates.run(deps, ["add", "alpha", "--goal", "Style it."]);
		await splates.run(deps, ["handoff", "alpha", "--agent", "nobody"]);

		expect((await env.journal.tail(1))[0]).toMatchObject({
			action: "handoff",
			task: "alpha",
			reason: "usage",
		});
	});

	it("lists the thinking levels an agent offers, hands out a task at one, and refuses any other", async () => {
		await env.fs.write(
			join(env.splatesHome, "offered.json"),
			JSON.stringify({
				format: 1,
				agents: {
					claude: [
						{
							id: "effort",
							name: "Effort",
							type: "select",
							category: "thought_level",
							current: "default",
							options: ["default", "low", "high"].map((value) => ({
								value,
								name: value,
								description: null,
							})),
						},
					],
				},
			}),
		);
		await splates.run(deps, ["agents"]);
		expect(env.out()).toContain("THINKING  default, low, high");

		env.proc.env.SPLATES_CONVERSATION = "c1";
		await splates.run(deps, [
			"add",
			"alpha",
			"--goal",
			"Style it.",
			"--agent",
			"claude",
			"--effort",
			"max",
		]);
		expect(env.proc.lastExit()).toBe(1);
		expect(env.out()).toContain("use one of default, low, high");

		await splates.run(deps, ["add", "alpha", "--goal", "Style it."]);
		await splates.run(deps, [
			"handoff",
			"alpha",
			"--agent",
			"claude",
			"--effort",
			"High",
		]);
		expect((await env.service.find("alpha")).state?.dispatch).toMatchObject({
			agent: "claude",
			effort: "high",
		});

		await splates.run(deps, [
			"todo",
			"add",
			"Restyle the header",
			"--agent",
			"claude",
			"--effort",
			"low",
		]);
		expect((await env.todos.all()).at(-1)?.state.assignee).toEqual({
			agent: "claude",
			effort: "low",
		});
	});

	it("refuses a port that cannot exist rather than trying to listen", async () => {
		// As the supervisor runs it.
		env.proc.env[SERVING] = "1";
		await splates.run(deps, ["server", "--port", "99999"]);

		expect(env.out()).not.toContain("  reply ");
		expect(env.proc.lastExit()).toBe(1);
	});

	it("says no tunnel is saved, and requests the token a setup needs", async () => {
		await splates.run(deps, ["tunnel", "status"]);
		expect(env.out()).toContain("no tunnel saved");

		await splates.run(deps, [
			"tunnel",
			"setup",
			"splates.example.com",
			"--email",
			"me@example.com",
		]);
		expect(env.out()).toContain("requested on the Creds page");
		expect(env.proc.lastExit()).toBe(25);
		expect(await env.creds.requests()).toMatchObject([
			{ name: "SPLATES_CLOUDFLARE_API_TOKEN", scope: "device", status: "open" },
		]);
	});
});
