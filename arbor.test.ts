import { expect, test } from "bun:test";
import { join } from "node:path";
import { claim } from "./claim";
import { create } from "./create";
import { escalate } from "./escalate";
import { Exit } from "./exit";
import { fixture } from "./fixture";
import { graft } from "./graft";
import { ls } from "./ls";
import { prune, trimTombstones } from "./prune";
import { readState, statePath, writeState } from "./state";

/** pid 1 always exists, so it stands in for another agent that is still running. */
const LIVE_PID = 1;

/** Runs a command that is expected to bail, and hands back how it bailed. */
async function bails(work: Promise<unknown>): Promise<Exit> {
	try {
		await work;
	} catch (e) {
		if (e instanceof Exit) {
			return e;
		}
		throw e;
	}
	throw new Error("expected a nonzero exit, but the command succeeded");
}

test("create makes a worktree, a branch, a port and a record", async () => {
	const f = await fixture();

	await create(f.ctx, "alpha");

	const state = await readState(f.ctx, "alpha");
	expect(state).toMatchObject({
		task: "alpha",
		branch: "task/alpha",
		status: "working",
		graftAttempts: 0,
	});
	expect(state?.port).toBeGreaterThanOrEqual(3100);
	expect(await f.ctx.fs.exists(join(state?.worktree ?? "", "README.md"))).toBe(
		true,
	);
	expect(
		await f.git(state?.worktree ?? "", "rev-parse", "--abbrev-ref", "HEAD"),
	).toBe("task/alpha");
	expect(f.out()).toContain("created alpha");
	await f.cleanup();
});

test("create refuses a name that is already taken and points at claim", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");

	const exit = await bails(create(f.ctx, "alpha"));

	expect(exit.reason).toBe("exists");
	expect(exit.code).toBe(10);
	expect(f.out()).toContain("arbor claim alpha");
	await f.cleanup();
});

test("create rejects task names that are not legal branch or directory names", async () => {
	const f = await fixture();

	for (const name of ["Alpha", "a b", "feature/x", "-alpha", ""]) {
		expect((await bails(create(f.ctx, name))).reason).toBe("usage");
	}
	await f.cleanup();
});

test("a failed postCreate hook is reported but keeps the worktree", async () => {
	const f = await fixture({ postCreate: "exit 3" });

	const exit = await bails(create(f.ctx, "alpha"));

	expect(exit.reason).toBe("hook_failed");
	expect(exit.code).toBe(9);
	const state = await readState(f.ctx, "alpha");
	expect(await f.ctx.fs.exists(state?.worktree ?? "")).toBe(true);
	await f.cleanup();
});

test("claim refuses a live lease and takes a cold one", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	const state = await readState(f.ctx, "alpha");
	if (!state) {
		throw new Error("no state");
	}

	// A live lease held by another, running process.
	await writeState(f.ctx, {
		...state,
		lease: {
			pid: LIVE_PID,
			hostname: f.ps.hostname,
			heartbeatAt: new Date().toISOString(),
		},
	});
	const exit = await bails(claim(f.ctx, "alpha"));
	expect(exit.reason).toBe("lease_live");
	expect(exit.code).toBe(6);

	// The same lease, gone cold because the heartbeat aged out.
	await writeState(f.ctx, {
		...state,
		lease: {
			pid: LIVE_PID,
			hostname: f.ps.hostname,
			heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
		},
	});
	await claim(f.ctx, "alpha");
	expect((await readState(f.ctx, "alpha"))?.lease?.pid).toBe(f.ps.pid);
	expect(f.out()).toContain("claimed alpha");
	await f.cleanup();
});

test("claim rebuilds a missing record and reports an interrupted rebase", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	const worktree = (await readState(f.ctx, "alpha"))?.worktree ?? "";

	// Stand the worktree in a half-finished rebase, then lose the record.
	await f.commit(f.ctx.root, "README.md", "trunk side\n", "trunk");
	await f.commit(worktree, "README.md", "task side\n", "task");
	await f.ctx.ps.spawnCapture(["git", "-C", worktree, "rebase", "main"]);
	await f.ctx.fs.rm(statePath(f.ctx, "alpha"));

	await claim(f.ctx, "alpha");

	expect(f.out()).toContain("state file rebuilt from disk");
	expect(f.out()).toContain("rebase in progress");
	expect(await readState(f.ctx, "alpha")).toMatchObject({
		branch: "task/alpha",
	});
	await f.cleanup();
});

test("claim reports a record whose worktree is gone as orphaned", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	const worktree = (await readState(f.ctx, "alpha"))?.worktree ?? "";
	await f.ctx.fs.rm(worktree, { recursive: true, force: true });

	const exit = await bails(claim(f.ctx, "alpha"));

	expect(exit.reason).toBe("orphaned");
	expect(f.out()).toContain("arbor prune alpha");
	await f.cleanup();
});

test("graft rebases, tests, then fast-forwards trunk", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	const worktree = (await readState(f.ctx, "alpha"))?.worktree ?? "";
	await f.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
	// Trunk moved on underneath, so the rebase has real work to do.
	await f.commit(f.ctx.root, "trunk.txt", "trunk\n", "add trunk");

	await graft(f.ctx, worktree);

	expect(await f.git(f.ctx.root, "log", "--oneline", "main")).toContain(
		"add alpha",
	);
	expect(
		await f.git(f.ctx.root, "rev-list", "--count", "--merges", "main"),
	).toBe("0");
	expect(await f.git(f.ctx.root, "rev-parse", "main")).toBe(
		await f.git(worktree, "rev-parse", "task/alpha"),
	);
	expect(await f.ctx.fs.exists(f.ctx.lockPath)).toBe(false);
	expect((await readState(f.ctx, "alpha"))?.graftAttempts).toBe(0);
	await f.cleanup();
});

test("graft refuses to run with uncommitted changes, before taking the lock", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	const worktree = (await readState(f.ctx, "alpha"))?.worktree ?? "";
	await f.ctx.fs.write(join(worktree, "alpha.txt"), "not committed\n");

	const exit = await bails(graft(f.ctx, worktree));

	expect(exit.reason).toBe("dirty");
	expect(exit.code).toBe(7);
	expect(await f.ctx.fs.exists(f.ctx.lockPath)).toBe(false);
	await f.cleanup();
});

test("a conflicting rebase is left in progress for the agent to resolve", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	const worktree = (await readState(f.ctx, "alpha"))?.worktree ?? "";
	await f.commit(worktree, "README.md", "task side\n", "task edit");
	await f.commit(f.ctx.root, "README.md", "trunk side\n", "trunk edit");

	const exit = await bails(graft(f.ctx, worktree));

	expect(exit.reason).toBe("conflict");
	expect(exit.code).toBe(2);
	expect(f.out()).toContain("README.md");
	expect(await f.git(worktree, "status", "--porcelain")).toContain(
		"UU README.md",
	);
	expect((await readState(f.ctx, "alpha"))?.graftAttempts).toBe(1);
	expect(await f.ctx.fs.exists(f.ctx.lockPath)).toBe(false);
	await f.cleanup();
});

test("tests failing after the rebase roll the branch back and leave trunk alone", async () => {
	const f = await fixture({ testCommand: "echo boom-from-tests; exit 1" });
	await create(f.ctx, "alpha");
	const worktree = (await readState(f.ctx, "alpha"))?.worktree ?? "";
	await f.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
	await f.commit(f.ctx.root, "trunk.txt", "trunk\n", "add trunk");
	const before = await f.git(worktree, "rev-parse", "HEAD");
	const trunkBefore = await f.git(f.ctx.root, "rev-parse", "main");

	const exit = await bails(graft(f.ctx, worktree));

	expect(exit.reason).toBe("tests_failed");
	expect(exit.code).toBe(3);
	expect(f.out()).toContain("boom-from-tests");
	expect(await f.git(worktree, "rev-parse", "HEAD")).toBe(before);
	expect(await f.git(f.ctx.root, "rev-parse", "main")).toBe(trunkBefore);
	expect(await f.ctx.fs.exists(f.ctx.lockPath)).toBe(false);
	await f.cleanup();
});

test("graft stops once the retry budget is spent", async () => {
	const f = await fixture({ graftRetryBudget: 2 });
	await create(f.ctx, "alpha");
	const state = await readState(f.ctx, "alpha");
	if (!state) {
		throw new Error("no state");
	}
	await writeState(f.ctx, { ...state, graftAttempts: 2 });

	const exit = await bails(graft(f.ctx, state.worktree));

	expect(exit.reason).toBe("budget_exhausted");
	expect(exit.code).toBe(5);
	expect(f.out()).toContain("arbor escalate");
	await f.cleanup();
});

test("graft refuses to land when the lease changed hands during the test run", async () => {
	const f = await fixture();
	const thief = join(f.root, "steal.js");
	const path = join(f.ctx.tasksDir, "alpha.json");
	await Bun.write(
		thief,
		`const s = JSON.parse(await Bun.file(${JSON.stringify(path)}).text());\n` +
			`s.lease = { pid: 999202, hostname: s.lease.hostname, heartbeatAt: new Date().toISOString() };\n` +
			`await Bun.write(${JSON.stringify(path)}, JSON.stringify(s));\n`,
	);
	f.ctx.config.testCommand = `bun ${thief}`;
	await create(f.ctx, "alpha");
	const worktree = (await readState(f.ctx, "alpha"))?.worktree ?? "";
	await f.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
	const trunkBefore = await f.git(f.ctx.root, "rev-parse", "main");

	const exit = await bails(graft(f.ctx, worktree));

	expect(exit.reason).toBe("lease_lost");
	expect(exit.code).toBe(4);
	expect(await f.git(f.ctx.root, "rev-parse", "main")).toBe(trunkBefore);
	expect(await f.ctx.fs.exists(f.ctx.lockPath)).toBe(false);
	await f.cleanup();
});

test("concurrent grafts serialize: one runs its tests and lands before the next starts", async () => {
	const f = await fixture();
	const trace = join(f.root, "trace.log");
	f.ctx.config.testCommand = `printf 'start-%s\\n' "$ARBOR_TASK" >> ${trace}; sleep 0.2; printf 'end-%s\\n' "$ARBOR_TASK" >> ${trace}`;

	await create(f.ctx, "alpha");
	await create(f.ctx, "beta");
	const alpha = (await readState(f.ctx, "alpha"))?.worktree ?? "";
	const beta = (await readState(f.ctx, "beta"))?.worktree ?? "";
	await f.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
	await f.commit(beta, "beta.txt", "beta\n", "add beta");

	await Promise.all([graft(f.ctx, alpha), graft(f.ctx, beta)]);

	const lines = (await f.ctx.fs.read(trace)).trim().split("\n");
	expect(lines).toHaveLength(4);
	// Never interleaved: whoever starts first also ends first.
	expect(lines[1]).toBe(`end-${lines[0]?.slice("start-".length)}`);
	expect(lines[3]).toBe(`end-${lines[2]?.slice("start-".length)}`);
	// Both landed, on a linear trunk.
	const log = await f.git(f.ctx.root, "log", "--oneline", "main");
	expect(log).toContain("add alpha");
	expect(log).toContain("add beta");
	expect(
		await f.git(f.ctx.root, "rev-list", "--count", "--merges", "main"),
	).toBe("0");
	await f.cleanup();
}, 20_000);

test("prune removes everything and says what was thrown away", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	const worktree = (await readState(f.ctx, "alpha"))?.worktree ?? "";
	await f.commit(worktree, "alpha.txt", "alpha\n", "unlanded work");

	await prune(f.ctx, "alpha");

	expect(f.out()).toContain("discarded 1 commit(s)");
	expect(await f.ctx.fs.exists(worktree)).toBe(false);
	expect(await f.ctx.fs.exists(statePath(f.ctx, "alpha"))).toBe(false);
	expect(await f.git(f.ctx.root, "branch", "--list", "task/alpha")).toBe("");
	await f.cleanup();
});

test("prune tells 'already pruned' apart from 'never existed'", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	await prune(f.ctx, "alpha");

	expect((await bails(prune(f.ctx, "alpha"))).reason).toBe("already_pruned");
	expect((await bails(prune(f.ctx, "never"))).reason).toBe("not_found");
	await f.cleanup();
});

test("prune cleans up leftovers when the worktree directory is already gone", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	const worktree = (await readState(f.ctx, "alpha"))?.worktree ?? "";
	await f.ctx.fs.rm(worktree, { recursive: true, force: true });

	await prune(f.ctx, "alpha");

	expect(f.out()).toContain("already gone");
	expect(await f.git(f.ctx.root, "branch", "--list", "task/alpha")).toBe("");
	await f.cleanup();
});

test("prune refuses a tree another agent is driving, unless forced", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	const state = await readState(f.ctx, "alpha");
	if (!state) {
		throw new Error("no state");
	}
	await writeState(f.ctx, {
		...state,
		lease: {
			pid: LIVE_PID,
			hostname: f.ps.hostname,
			heartbeatAt: new Date().toISOString(),
		},
	});

	expect((await bails(prune(f.ctx, "alpha"))).reason).toBe("lease_live");

	await prune(f.ctx, "alpha", { force: true });
	expect(await f.ctx.fs.exists(state.worktree)).toBe(false);
	await f.cleanup();
});

test("ls lists tasks, survives a corrupt record, and flags orphans", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	await create(f.ctx, "beta");
	await f.ctx.fs.write(statePath(f.ctx, "broken"), "{not json");
	const beta = (await readState(f.ctx, "beta"))?.worktree ?? "";
	await f.ctx.fs.rm(beta, { recursive: true, force: true });

	await ls(f.ctx);
	expect(f.out()).toContain("alpha");
	expect(f.out()).toContain("unknown"); // the corrupt row, not a crash
	expect(f.out()).toContain("orphaned");

	f.log.clear();
	await ls(f.ctx, { json: true });
	const rows = JSON.parse(f.out());
	expect(rows.map((r: { task: string }) => r.task)).toEqual([
		"alpha",
		"beta",
		"broken",
	]);
	await f.cleanup();
});

test("ls says so plainly when there is nothing to list", async () => {
	const f = await fixture();

	await ls(f.ctx);

	expect(f.out()).toContain("no workstreams");
	await f.cleanup();
});

test("escalate records the reason, drops the lease, and leaves the tree alone", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");
	const worktree = (await readState(f.ctx, "alpha"))?.worktree ?? "";
	await f.ctx.fs.write(join(worktree, "half-done.txt"), "work in progress\n");

	await escalate(f.ctx, "both sides restructured the router", worktree);

	const state = await readState(f.ctx, "alpha");
	expect(state).toMatchObject({ status: "escalated", lease: null });
	expect(state?.escalations).toHaveLength(1);
	expect(await f.ctx.fs.exists(join(worktree, "half-done.txt"))).toBe(true);

	await escalate(f.ctx, "second thoughts", worktree);
	expect((await readState(f.ctx, "alpha"))?.escalations).toHaveLength(2);
	await f.cleanup();
});

test("escalate outside a worktree needs an explicit task", async () => {
	const f = await fixture();
	await create(f.ctx, "alpha");

	expect((await bails(escalate(f.ctx, "needs a human", f.root))).reason).toBe(
		"usage",
	);

	await escalate(f.ctx, "needs a human", f.root, "alpha");
	expect((await readState(f.ctx, "alpha"))?.status).toBe("escalated");
	await f.cleanup();
});

test("the pruned ledger drops its oldest entries instead of growing forever", async () => {
	const f = await fixture();
	const day = (n: number) => `2026-0${n}-01T00:00:00.000Z\n`;
	for (const [i, task] of ["oldest", "middle", "newest"].entries()) {
		await f.ctx.fs.write(`${f.ctx.prunedDir}/${task}`, day(i + 1));
	}

	await trimTombstones(f.ctx, 2);

	expect((await f.ctx.fs.readdir(f.ctx.prunedDir)).sort()).toEqual([
		"middle",
		"newest",
	]);

	// A real prune trims as it writes: pruning a fourth task evicts "middle".
	await create(f.ctx, "alpha");
	await prune(f.ctx, "alpha");
	await trimTombstones(f.ctx, 2);
	expect((await f.ctx.fs.readdir(f.ctx.prunedDir)).sort()).toEqual([
		"alpha",
		"newest",
	]);
	await f.cleanup();
});
