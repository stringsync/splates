import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { color } from "@webappwiz/log";
import { repo } from "./lib/testing";

const CLI = join(import.meta.dir, "index.ts");

/** A repo of its own per test, so the four of them can run at once. */
const setup = async () => {
	const r = await repo();
	// The only thing worth overriding: the default `bun test` fails in a
	// worktree that has no tests, and graft would read that as a real failure.
	await r.fs.write(
		join(r.root, "arbor.config.ts"),
		`export default { testCommand: "true" };\n`,
	);

	/** Runs the CLI the way an agent does: a fresh process, a cwd, an exit code. */
	const arbor = async (cwd: string, ...args: string[]) => {
		const { exitCode, stdout, stderr } = await r.ps.spawnCapture(
			["bun", CLI, ...args],
			{ cwd },
		);
		return { exitCode, stdout: color.strip(stdout), stderr };
	};

	const rows = async () =>
		JSON.parse((await arbor(r.root, "ls", "--json")).stdout) as {
			task: string;
			status: string;
			lease: "live" | "cold" | "none";
			worktree: string;
		}[];

	return { ...r, arbor, rows };
};

describe.concurrent("arbor", () => {
	it("lands both trees on trunk without a merge when two agents work at once", async () => {
		await using r = await setup();
		const { arbor, rows } = r;

		expect((await arbor(r.root, "create", "alpha")).exitCode).toBe(0);
		expect((await arbor(r.root, "create", "beta")).exitCode).toBe(0);

		const listed = await rows();
		expect(listed.map((row) => row.task)).toEqual(["alpha", "beta"]);
		const [alpha, beta] = listed.map((row) => row.worktree);
		if (!alpha || !beta) {
			throw new Error("create did not record a worktree path");
		}

		// Each agent resumes a tree it did not create: a fresh thread starts here.
		const claimed = await arbor(alpha, "claim", "alpha");
		expect(claimed.exitCode).toBe(0);
		expect(claimed.stdout).toContain("uncommitted: none");
		await r.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		const grafted = await arbor(alpha, "graft");
		expect(grafted.exitCode).toBe(0);
		expect(grafted.stdout).toContain("grafted alpha onto main");

		// beta rebases onto a trunk that alpha moved out from under it.
		expect((await arbor(beta, "claim", "beta")).exitCode).toBe(0);
		await r.commit(beta, "beta.txt", "beta\n", "add beta");
		expect((await arbor(beta, "graft")).exitCode).toBe(0);

		const log = await r.gitCli(r.root, "log", "--oneline", "main");
		expect(log).toContain("add alpha");
		expect(log).toContain("add beta");
		expect(
			await r.gitCli(r.root, "rev-list", "--count", "--merges", "main"),
		).toBe("0");

		expect(await rows()).toEqual([]);
		const pruned = await arbor(r.root, "prune", "alpha");
		expect(pruned.exitCode).toBe(13);
		expect(pruned.stdout).toContain("already_pruned");

		// The journal outlives the tasks: both grafts and the refused prune.
		const journal = JSON.parse(
			(await arbor(r.root, "log", "--json")).stdout,
		) as { action: string; task: string | null; reason: string | null }[];
		expect(journal).toMatchObject([
			{ action: "create", task: "alpha", reason: null },
			{ action: "create", task: "beta", reason: null },
			{ action: "claim", task: "alpha", reason: null },
			{ action: "graft", task: "alpha", reason: null },
			{ action: "claim", task: "beta", reason: null },
			{ action: "graft", task: "beta", reason: null },
			{ action: "prune", task: "alpha", reason: "already_pruned" },
		]);
	});

	it("lands the work when a second agent picks up an escalated tree", async () => {
		await using r = await setup();
		const { arbor, rows } = r;

		// Tests pass only once the committed marker says so, which is how the
		// first agent's graft fails for a reason the second agent can fix.
		await r.fs.write(
			join(r.root, "arbor.config.ts"),
			`export default { testCommand: "grep -q ok status.txt" };\n`,
		);
		expect((await arbor(r.root, "create", "gamma")).exitCode).toBe(0);
		const tree = (await rows())[0]?.worktree;
		if (!tree) {
			throw new Error("create did not record a worktree path");
		}

		expect((await arbor(tree, "claim", "gamma")).exitCode).toBe(0);
		await r.commit(tree, "status.txt", "wrong\n", "add status");
		const failed = await arbor(tree, "graft");
		expect(failed.exitCode).not.toBe(0);
		expect(await r.gitCli(r.root, "log", "--oneline", "main")).not.toContain(
			"add status",
		);
		expect(
			(await arbor(tree, "escalate", "cannot tell what ok means")).exitCode,
		).toBe(0);

		// Second agent, fresh thread: the escalated tree is still claimable, and
		// the earlier failure did not eat the whole graft budget.
		const resumed = await arbor(tree, "claim", "gamma");
		expect(resumed.exitCode).toBe(0);
		expect(resumed.stdout).toContain("status:   escalated");
		expect(resumed.stdout).toContain("attempts: 1");
		await r.commit(tree, "status.txt", "ok\n", "fix status");
		const grafted = await arbor(tree, "graft");
		expect(grafted.exitCode).toBe(0);
		expect(grafted.stdout).toContain("grafted gamma onto main");
		expect(await r.gitCli(r.root, "log", "--oneline", "main")).toContain(
			"fix status",
		);
	});

	it("reports the uncommitted work and lands it when an agent dies mid-task", async () => {
		await using r = await setup();
		const { arbor, rows } = r;

		expect((await arbor(r.root, "create", "delta")).exitCode).toBe(0);
		const tree = (await rows())[0]?.worktree;
		if (!tree) {
			throw new Error("create did not record a worktree path");
		}

		// The first agent claims, writes, and never comes back: the record keeps
		// a lease whose pid died with the process.
		expect((await arbor(tree, "claim", "delta")).exitCode).toBe(0);
		await r.fs.write(join(tree, "delta.txt"), "half done\n");
		expect((await rows())[0]?.lease).toBe("cold");

		// Second agent: the dead lease does not block the claim, and the
		// half-finished file is reported rather than silently inherited.
		const resumed = await arbor(tree, "claim", "delta");
		expect(resumed.exitCode).toBe(0);
		expect(resumed.stdout).toContain("uncommitted (1)");
		expect(resumed.stdout).toContain("delta.txt");

		await r.commit(tree, "delta.txt", "finished\n", "finish delta");
		expect((await arbor(tree, "graft")).exitCode).toBe(0);
		expect(await r.gitCli(r.root, "log", "--oneline", "main")).toContain(
			"finish delta",
		);
	});

	it("lands the tree on a retry when an agent is killed mid-graft", async () => {
		await using r = await setup();
		const { arbor, rows } = r;

		// SIGKILL from inside the test gate: the first graft dies after rebasing
		// and before trunk moves, holding both the lease and the graft lock. The
		// marker file makes it happen exactly once, so the retry can pass.
		const die = join(r.root, "die");
		await r.fs.write(
			join(r.root, "arbor.config.ts"),
			`export default { testCommand: "if [ -f ${die} ]; then rm ${die}; kill -9 $PPID; fi" };\n`,
		);
		await r.fs.write(die, "");
		expect((await arbor(r.root, "create", "epsilon")).exitCode).toBe(0);
		const tree = (await rows())[0]?.worktree;
		if (!tree) {
			throw new Error("create did not record a worktree path");
		}

		expect((await arbor(tree, "claim", "epsilon")).exitCode).toBe(0);
		await r.commit(tree, "epsilon.txt", "epsilon\n", "add epsilon");
		expect((await arbor(tree, "graft")).exitCode).not.toBe(0);
		expect(await r.fs.exists(die)).toBe(false);

		const stalled = (await rows())[0];
		expect(stalled?.status).toBe("grafting");
		expect(stalled?.lease).toBe("cold");
		expect(await r.gitCli(r.root, "log", "--oneline", "main")).not.toContain(
			"add epsilon",
		);
		expect(await r.fs.exists(join(r.arborDir, "graft.lock"))).toBe(true);

		// Second agent: the abandoned lock is stolen rather than waited out.
		const resumed = await arbor(tree, "claim", "epsilon");
		expect(resumed.exitCode).toBe(0);
		expect(resumed.stdout).toContain("status:   grafting");
		const grafted = await arbor(tree, "graft");
		expect(grafted.exitCode).toBe(0);
		expect(grafted.stdout).toContain("grafted epsilon onto main");
		expect(await r.gitCli(r.root, "log", "--oneline", "main")).toContain(
			"add epsilon",
		);
		expect(await rows()).toEqual([]);
	});

	it("holds a second agent until the tree it overlaps has landed", async () => {
		await using r = await setup();
		const { arbor, rows } = r;

		expect((await arbor(r.root, "create", "zeta")).exitCode).toBe(0);
		const [zeta] = (await rows()).map((row) => row.worktree);
		if (!zeta) {
			throw new Error("create did not record a worktree path");
		}
		await r.commit(zeta, "shared.txt", "zeta\n", "add shared");

		// The agent that would touch the same files waits instead of racing.
		const waiting = arbor(r.root, "wait", "zeta");
		expect((await arbor(zeta, "graft")).exitCode).toBe(0);

		const waited = await waiting;
		expect(waited.exitCode).toBe(0);
		expect(waited.stdout).toContain("gone");

		// Giving up is a refusal, so the agent has something to escalate on.
		expect((await arbor(r.root, "create", "eta")).exitCode).toBe(0);
		const timedOut = await arbor(r.root, "wait", "eta", "--timeout", "0");
		expect(timedOut.exitCode).toBe(14);
		expect(JSON.parse(timedOut.stdout)).toMatchObject({
			reason: "timed_out",
			task: "eta",
			status: "working",
		});
	});
});
