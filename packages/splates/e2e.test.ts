import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { Testing } from "@stringsync/splates-server/testing";
import { ensure } from "webappwiz/assert";
import { color } from "webappwiz/log";

// Every test here drives real git in a repo of its own, dozens of processes
// each: fast alone, but starved past bun's 5s default when the whole suite
// runs in parallel on a busy machine.
setDefaultTimeout(30_000);

describe.concurrent("splates", () => {
	it("prints help without starting a server when no command is given", async () => {
		await using cli = await setup();
		const { exitCode, stdout } = await cli.splates(cli.env.root);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Usage: splates <command>");
		expect(stdout).toContain("  server ");
		expect(stdout).not.toContain("the default command");
		expect(stdout).not.toContain("  dev ");
	});

	it("does not expose the checkout's development namespace in the published CLI", async () => {
		await using cli = await setup();
		const { stdout } = await cli.splates(
			cli.env.root,
			"dev",
			"--port",
			"99999",
		);

		expect(stdout).toContain("Usage: splates <command>");
		expect(stdout).not.toContain("Usage: splates dev");
		expect(stdout).not.toContain("  fix ");
	});

	it.each([{ args: [] }, { args: ["--help"] }])(
		"dispatches a checkout's dev $args to its own namespace",
		async ({ args }) => {
			await using cli = await setup();
			const { exitCode, stdout: styled } = await cli.env.ps.spawnCapture(
				[join(import.meta.dirname, "../../bin/splates"), "dev", ...args],
				// NO_COLOR keeps the help plain even when the terminal forces color.
				{ cwd: cli.env.root, env: { SPLATES_ROOT: "", NO_COLOR: "1" } },
			);
			const stdout = Bun.stripANSI(styled);

			expect(exitCode).toBe(0);
			expect(stdout).toContain("Usage: splates dev <command>");
			expect(stdout).toContain("  fix ");
			expect(stdout).toContain("  test ");
			expect(stdout).not.toContain("  server ");
		},
	);

	it("exposes server options through the explicit server command", async () => {
		await using cli = await setup();
		const { exitCode, stdout } = await cli.splates(
			cli.env.root,
			"server",
			"run",
			"--help",
		);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Usage: splates server run");
		expect(stdout).toContain("--port");
		expect(stdout).toContain("--tunnel");
	});

	it("lists running the server first among its commands, as what it does bare", async () => {
		await using cli = await setup();
		const { exitCode, stdout } = await cli.splates(
			cli.env.root,
			"server",
			"--help",
		);

		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/run .*\(default\)/);
		expect(stdout).toContain("deploy");
	});

	it("lands both trees on trunk without a merge when two agents work at once", async () => {
		await using cli = await setup();
		const { env, splates, rows } = cli;

		expect(
			(await splates(env.root, "add", "alpha", "--goal", "land it")).exitCode,
		).toBe(0);
		expect(
			(await splates(env.root, "add", "beta", "--goal", "land it")).exitCode,
		).toBe(0);

		const listed = await rows();
		expect(listed.map((row) => row.task)).toEqual(["alpha", "beta"]);
		const [alpha, beta] = listed.map((row) => row.worktree) as [string, string];
		expect([alpha, beta]).not.toContain("");

		// Each agent resumes a tree it did not create: a fresh thread starts here.
		const claimed = await splates(alpha, "claim", "alpha");
		expect(claimed.exitCode).toBe(0);
		expect(claimed.stdout).toContain("uncommitted: none");
		await env.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		await env.finish(alpha);
		const merged = await splates(alpha, "merge");
		expect(merged.exitCode).toBe(0);
		expect(merged.stdout).toContain("merged alpha onto main");

		// beta rebases onto a trunk that alpha moved out from under it.
		expect((await splates(beta, "claim", "beta")).exitCode).toBe(0);
		await env.commit(beta, "beta.txt", "beta\n", "add beta");
		await env.finish(beta);
		expect((await splates(beta, "merge")).exitCode).toBe(0);

		const log = await env.gitCli(env.root, "log", "--oneline", "main");
		expect(log).toContain("add alpha");
		expect(log).toContain("add beta");
		expect(
			await env.gitCli(env.root, "rev-list", "--count", "--merges", "main"),
		).toBe("0");

		expect(await rows()).toEqual([]);
	});

	it("keeps the journal of a task after it has merged and gone", async () => {
		await using cli = await setup();
		const { env, splates } = cli;

		const added = await splates(env.root, "add", "alpha", "--goal", "land it");
		expect(added.exitCode).toBe(0);
		const alpha = worktreeFromAdd(added.stdout);
		expect((await splates(alpha, "claim", "alpha")).exitCode).toBe(0);
		await env.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		await env.finish(alpha);
		expect((await splates(alpha, "merge")).exitCode).toBe(0);

		const removed = await splates(env.root, "remove", "alpha");
		expect(removed.exitCode).toBe(13);
		expect(removed.stdout).toContain("already_removed");

		// The journal outlives the task: its merge and the refused remove.
		const journal = JSON.parse(
			(await splates(env.root, "log", "--json")).stdout,
		) as { action: string; task: string | null; reason: string | null }[];
		expect(journal).toMatchObject([
			{ action: "add", task: "alpha", reason: null },
			{ action: "claim", task: "alpha", reason: null },
			{ action: "merge", task: "alpha", reason: null },
			{ action: "remove", task: "alpha", reason: "already_removed" },
		]);
	});

	it("lands a stacked task in its parent's worktree, and the parent on trunk", async () => {
		await using cli = await setup();
		const { env, splates, rows } = cli;

		const parentAdded = await splates(
			env.root,
			"add",
			"parent",
			"--goal",
			"land it",
		);
		expect(parentAdded.exitCode).toBe(0);
		const parent = worktreeFromAdd(parentAdded.stdout);
		await env.commit(parent, "parent.txt", "parent\n", "add parent");

		// The parent hands out a part from inside its own tree, based on its own
		// branch, so the part lands on it rather than on trunk.
		const partAdded = await splates(
			parent,
			"add",
			"part",
			"--base",
			"task/parent",
			"--goal",
			"land it",
		);
		expect(partAdded.exitCode).toBe(0);
		const part = worktreeFromAdd(partAdded.stdout);
		await env.commit(part, "part.txt", "part\n", "add part");

		await env.finish(part);
		const landed = await splates(part, "merge");
		expect(landed.exitCode).toBe(0);
		expect(landed.stdout).toContain("merged part onto task/parent");
		expect(landed.stdout).toContain(parent);
		// The parent's own tree has the file, not just the branch.
		expect(await env.fs.exists(join(part, "part.txt"))).toBe(false);
		expect(await env.fs.exists(join(parent, "part.txt"))).toBe(true);
		expect(
			await env.gitCli(env.root, "log", "--oneline", "main"),
		).not.toContain("add part");

		// The parent then lands both commits on trunk with its own merge.
		await env.finish(parent);
		expect((await splates(parent, "merge")).exitCode).toBe(0);
		const log = await env.gitCli(env.root, "log", "--oneline", "main");
		expect(log).toContain("add parent");
		expect(log).toContain("add part");
		expect(await rows()).toEqual([]);
	});

	it("lands the work when a second agent picks up an escalated tree", async () => {
		await using cli = await setup();
		const { env, splates } = cli;

		// Tests pass only once the committed marker says so, which is how the
		// first agent's merge fails for a reason the second agent can fix.
		await env.fs.write(
			join(env.root, "splates.config.ts"),
			`export default { preMerge: "grep -q ok status.txt" };\n`,
		);
		const added = await splates(env.root, "add", "gamma", "--goal", "land it");
		expect(added.exitCode).toBe(0);
		const tree = worktreeFromAdd(added.stdout);

		expect((await splates(tree, "claim", "gamma")).exitCode).toBe(0);
		await env.commit(tree, "status.txt", "wrong\n", "add status");
		await env.finish(tree);
		const failed = await splates(tree, "merge");
		expect(failed.exitCode).not.toBe(0);
		expect(
			await env.gitCli(env.root, "log", "--oneline", "main"),
		).not.toContain("add status");
		expect(
			(await splates(tree, "escalate", "cannot tell what ok means")).exitCode,
		).toBe(0);

		// Second agent, fresh thread: the escalated tree is still claimable, is
		// someone's work again, and the earlier failure did not eat the whole
		// merge budget.
		const resumed = await splates(tree, "claim", "gamma");
		expect(resumed.exitCode).toBe(0);
		expect(resumed.stdout).toContain("status:   working (was escalated)");
		expect(resumed.stdout).toContain("attempts: 1");
		await env.commit(tree, "status.txt", "ok\n", "fix status");
		await env.finish(tree);
		const merged = await splates(tree, "merge");
		expect(merged.exitCode).toBe(0);
		expect(merged.stdout).toContain("merged gamma onto main");
		expect(await env.gitCli(env.root, "log", "--oneline", "main")).toContain(
			"fix status",
		);
	});

	it("reports the uncommitted work and lands it when an agent dies mid-task", async () => {
		await using cli = await setup();
		const { env, splates, rows } = cli;

		const added = await splates(env.root, "add", "delta", "--goal", "land it");
		expect(added.exitCode).toBe(0);
		const tree = worktreeFromAdd(added.stdout);

		// The first agent claims, writes, and never comes back: the record keeps
		// a lease whose pid died with the process.
		expect((await splates(tree, "claim", "delta")).exitCode).toBe(0);
		await env.fs.write(join(tree, "delta.txt"), "half done\n");
		expect((await rows())[0]?.lease).toBe("stale");

		// Second agent: the dead lease does not block the claim, and the
		// half-finished file is reported rather than silently inherited.
		const resumed = await splates(tree, "claim", "delta");
		expect(resumed.exitCode).toBe(0);
		expect(resumed.stdout).toContain("uncommitted (1)");
		expect(resumed.stdout).toContain("delta.txt");

		await env.commit(tree, "delta.txt", "finished\n", "finish delta");
		await env.finish(tree);
		expect((await splates(tree, "merge")).exitCode).toBe(0);
		expect(await env.gitCli(env.root, "log", "--oneline", "main")).toContain(
			"finish delta",
		);
	});

	// scry-ignore simple-test-setup: its killing preMerge and marker file are this test's alone, and older than this task
	it("lands the tree on a retry when an agent is killed mid-merge", async () => {
		await using cli = await setup();
		const { env, splates, rows } = cli;

		// SIGKILL from inside the test gate: the first merge dies after rebasing
		// and before trunk moves, holding both the lease and the merge lock. The
		// marker file makes it happen exactly once, so the retry can pass.
		const die = join(env.root, "die");
		await env.fs.write(
			join(env.root, "splates.config.ts"),
			`export default { preMerge: "if [ -f ${die} ]; then rm ${die}; kill -9 $PPID; fi" };\n`,
		);
		await env.fs.write(die, "");
		const added = await splates(
			env.root,
			"add",
			"epsilon",
			"--goal",
			"land it",
		);
		expect(added.exitCode).toBe(0);
		const tree = worktreeFromAdd(added.stdout);

		expect((await splates(tree, "claim", "epsilon")).exitCode).toBe(0);
		await env.commit(tree, "epsilon.txt", "epsilon\n", "add epsilon");
		await env.finish(tree);
		expect((await splates(tree, "merge")).exitCode).not.toBe(0);
		expect(await env.fs.exists(die)).toBe(false);

		const stalled = (await rows())[0];
		expect(stalled?.status).toBe("merging");
		expect(stalled?.lease).toBe("stale");
		expect(
			await env.gitCli(env.root, "log", "--oneline", "main"),
		).not.toContain("add epsilon");
		expect(await env.fs.exists(join(env.splatesDir, "merge.lock"))).toBe(true);

		// Second agent: the abandoned lock is stolen rather than waited out.
		const resumed = await splates(tree, "claim", "epsilon");
		expect(resumed.exitCode).toBe(0);
		expect(resumed.stdout).toContain("status:   merging");
		await env.finish(tree);
		const merged = await splates(tree, "merge");
		expect(merged.exitCode).toBe(0);
		expect(merged.stdout).toContain("merged epsilon onto main");
		expect(await env.gitCli(env.root, "log", "--oneline", "main")).toContain(
			"add epsilon",
		);
		expect(await rows()).toEqual([]);
	});

	it("refuses every command but `splates init` in a repository it never ran in", async () => {
		await using cli = await setup({ init: false });
		const { env, splates } = cli;

		const uninitialized = {
			exitCode: 20,
			stderr: expect.stringContaining("Run `splates init` in it once"),
		};
		expect([
			await splates(env.root, "task", "list"),
			await splates(env.root, "add", "alpha", "--goal", "land it"),
			await splates(env.root, "list"),
		]).toMatchObject([uninitialized, uninitialized, uninitialized]);
		expect(await env.fs.exists(env.splatesDir)).toBe(false);
		expect(await env.projects.list()).toEqual([]);

		const [registered, again] = [
			await splates(env.root, "init"),
			await splates(env.root, "init"),
		];
		expect(registered.exitCode).toBe(0);
		expect(registered.stdout).toContain(`registered ${env.root}`);
		expect(await env.fs.read(join(env.splatesDir, "format"))).toBe("2\n");
		expect(again.stdout).toContain(`${env.root} is already registered`);
		expect(
			(await splates(env.root, "add", "alpha", "--goal", "land it")).exitCode,
		).toBe(0);
	});

	it("registers a splates project already under way, by its main tree", async () => {
		await using cli = await setup();
		const { env, splates } = cli;
		await env.projects.forget(env.root);
		expect(
			(await splates(env.root, "add", "alpha", "--goal", "land it")).exitCode,
		).toBe(0);

		const [alpha] = (await cli.rows()).map((row) => row.worktree);
		expect((await splates(alpha as string, "init")).exitCode).toBe(0);

		expect((await env.projects.list()).map((each) => each.root)).toEqual([
			env.root,
		]);
	});

	it("forgets this repository, keeping its records", async () => {
		await using cli = await setup();
		const { env, splates } = cli;
		expect(
			(await splates(env.root, "add", "alpha", "--goal", "land it")).exitCode,
		).toBe(0);

		const forgot = await splates(env.root, "forget");
		const again = await splates(env.root, "forget");

		expect(forgot.exitCode).toBe(0);
		expect(forgot.stdout).toContain(`forgot ${env.root}`);
		expect(again.stdout).toContain(`${env.root} is not registered`);
		expect(await env.projects.list()).toEqual([]);
		expect((await splates(env.root, "init")).exitCode).toBe(0);
		expect((await cli.rows()).map((row) => row.task)).toEqual(["alpha"]);
	});

	it("leaves records a newer splates wrote alone", async () => {
		await using cli = await setup();
		const { env, splates } = cli;
		const format = join(env.splatesDir, "format");

		expect((await splates(env.root, "list")).exitCode).toBe(0);
		expect(await env.fs.read(format)).toBe("2\n");

		await env.fs.write(format, "3\n");
		const refused = await splates(
			env.root,
			"add",
			"alpha",
			"--goal",
			"land it",
		);
		expect(refused.exitCode).toBe(19);
		expect(refused.stdout).toContain("outdated");
		expect(refused.stderr).toContain("bunx @stringsync/splates@latest");
		expect(await env.fs.exists(join(env.splatesDir, "tasks", "1.json"))).toBe(
			false,
		);
	});
});

const CLI = join(import.meta.dirname, "index.ts");

const worktreeFromAdd = (stdout: string) =>
	ensure.defined(
		stdout.match(/^ {2}worktree: (.+)$/m)?.[1],
		"add did not print a worktree path",
	);

/** A repo of its own per test, so the four of them can run at once. */
const setup = async ({ init = true }: { init?: boolean } = {}) => {
	const env = await Testing.open({ init });
	// A gate that passes, so the happy paths exercise merge rather than the
	// fixture repo's (nonexistent) tests.
	await env.fs.write(
		join(env.root, "splates.config.ts"),
		`export default { preMerge: "true" };\n`,
	);

	// `splates init` installs its skill with `bunx skills add`, which reaches
	// GitHub: a `bunx` that does nothing keeps the tests off the network.
	const bin = join(env.splatesHome, "..", "bin");
	await env.fs.mkdir(bin);
	await env.fs.write(join(bin, "bunx"), "#!/bin/sh\nexit 0\n");
	await chmod(join(bin, "bunx"), 0o755);

	/** Runs the CLI the way an agent does: a fresh process, a cwd, an exit code. */
	const splates = async (cwd: string, ...args: string[]) => {
		const { exitCode, stdout, stderr } = await env.ps.spawnCapture(
			["bun", CLI, ...args],
			{ cwd, env: { PATH: `${bin}:${process.env.PATH}` } },
		);
		return { exitCode, stdout: color.strip(stdout), stderr };
	};

	const rows = async () =>
		JSON.parse((await splates(env.root, "list", "--json")).stdout) as {
			task: string;
			status: string;
			lease: "held" | "stale" | "none";
			worktree: string;
		}[];

	return {
		env,
		splates,
		rows,
		[Symbol.asyncDispose]: () => env.disposeAsync(),
	};
};
