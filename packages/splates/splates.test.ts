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
			"kimi",
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
		).toBe(2);
	});

	it("prints what undoing an area would forget, and undoes nothing", async () => {
		await env.secrets.device.set("OPENAI_API_KEY", "sk-test");

		await splates.run(deps, ["setup", "dictation", "--undo", "--json"]);

		const plan = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(plan).toMatchObject({
			area: "dictation",
			creds: [{ name: "OPENAI_API_KEY", keptFor: null }],
			refused: null,
		});
		expect(await env.secrets.device.get("OPENAI_API_KEY")).toBe("sk-test");
	});

	// scry-ignore simple-test-setup: the started task is what numbers the queued task after it, which this case checks.
	it("edits the queued tasks added beside a started one", async () => {
		await splates.run(deps, ["add", "alpha", "--goal", "land it"]);
		await env.fs.write(join(env.root, "a.png"), "a");
		await splates.run(deps, [
			"task",
			"add",
			"write docs",
			"the CLI first",
			"--slug",
			"cli-docs",
			"--file",
			"a.png",
		]);
		// Task alpha took number 1, so the queued task is numbered after it.
		const [queued] = await env.tasks.all();
		const id = queued?.id ?? 0;
		expect(id).toBe(2);
		const [attached = ""] = queued?.files ?? [];
		await splates.run(deps, [
			"task",
			"update",
			String(id),
			"--subject",
			"write the docs",
			"--slug",
			"docs",
			"--position",
			"1",
			"--remove-file",
			basename(attached),
		]);
		expect((await env.tasks.find(id)).state).toMatchObject({
			subject: "write the docs",
			slug: "docs",
			text: "the CLI first",
			position: 1,
			files: [],
		});

		await splates.run(deps, ["log", "--json"]);
		const entries = JSON.parse(String(env.log.entries.at(-1)?.message));
		expect(entries.map((entry: { action: string }) => entry.action)).toContain(
			"task update",
		);
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

	it("logs the task it queues, with where it went", async () => {
		await splates.run(deps, ["task", "add", "first", "--slug", "first"]);
		await splates.run(deps, [
			"task",
			"add",
			"Upload retries forever on a 413",
			"--slug",
			"upload-413",
			"--position",
			"1",
			"--lane",
			"new",
		]);

		expect((await env.journal.tail(1))[0]).toMatchObject({
			action: "task add",
			reason: null,
			number: 2,
			subject: "Upload retries forever on a 413",
			lane: 1,
			position: 1,
		});
	});

	it("defers a task with why it stopped and each blocker it names", async () => {
		await splates.run(deps, ["task", "add", "build the client", "--slug", "c"]);
		await splates.run(deps, ["add", "alpha", "--goal", "retry on 413"]);
		await splates.run(deps, [
			"remove",
			"alpha",
			"--reason",
			"blocked",
			"--why",
			"It needs the new client.",
			"--blocked-by",
			"1",
			"--ask",
			"Keep the retry for old clients?",
			"--waiting-on",
			"an upstream release",
		]);

		await splates.run(deps, ["task", "show", "3"]);
		expect(env.out()).toContain("task 3 retry on 413");
		expect(env.out()).toContain("It needs the new client.");
		expect(env.out()).toContain("[ ] #1 build the client (ready)");
		expect(env.out()).toContain(
			"[ ] the person: Keep the retry for old clients? (open)",
		);
		expect(env.out()).toContain("[ ] an upstream release (open)");
	});

	it("links every task a repeated or comma-listed --blocked-by names", async () => {
		await splates.run(deps, ["task", "add", "a", "--slug", "a"]);
		await splates.run(deps, ["task", "add", "b", "--slug", "b"]);
		await splates.run(deps, ["task", "add", "c", "--slug", "c"]);
		await splates.run(deps, [
			"task",
			"add",
			"d",
			"--slug",
			"d",
			"--blocked-by",
			"1",
			"--blocked-by",
			"2",
		]);
		await splates.run(deps, ["task", "update", "4", "--blocked-by", "3"]);

		await splates.run(deps, ["task", "show", "4"]);
		expect(env.out()).toMatch(/blocked.*1.*2.*3/s);
	});

	it("lists the thinking levels an agent offers, starts a task on one, and refuses any other", async () => {
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

		await splates.run(deps, [
			"add",
			"alpha",
			"--goal",
			"Style it.",
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
			"task",
			"add",
			"Restyle the header",
			"--slug",
			"header-style",
			"--agent",
			"claude",
			"--effort",
			"low",
		]);
		expect((await env.tasks.all()).at(-1)?.state.assignee).toEqual({
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
