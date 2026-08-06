import { expect, test } from "bun:test";
import { join } from "node:path";
import { bails, fixture } from "../lib/fixture";
import { create } from "./create";
import { graft } from "./graft";

test("graft rebases, tests, then fast-forwards trunk", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	const worktree = (await f.arbor.store.find("alpha")).path;
	await f.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
	// Trunk moved on underneath, so the rebase has real work to do.
	await f.commit(f.root, "trunk.txt", "trunk\n", "add trunk");

	await graft(f.arbor, worktree);

	expect(await f.git(f.root, "log", "--oneline", "main")).toContain(
		"add alpha",
	);
	expect(await f.git(f.root, "rev-list", "--count", "--merges", "main")).toBe(
		"0",
	);
	expect(await f.git(f.root, "rev-parse", "main")).toBe(
		await f.git(worktree, "rev-parse", "task/alpha"),
	);
	expect(await f.fs.exists(f.lockPath)).toBe(false);
	expect((await f.arbor.store.find("alpha")).state?.graftAttempts).toBe(0);
	await f.cleanup();
});

test("graft refuses to run with uncommitted changes, before taking the lock", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	const worktree = (await f.arbor.store.find("alpha")).path;
	await f.fs.write(join(worktree, "alpha.txt"), "not committed\n");

	const exit = await bails(graft(f.arbor, worktree));

	expect(exit.reason).toBe("dirty");
	expect(exit.code).toBe(7);
	expect(await f.fs.exists(f.lockPath)).toBe(false);
	await f.cleanup();
});

test("a conflicting rebase is left in progress for the agent to resolve", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	const worktree = (await f.arbor.store.find("alpha")).path;
	await f.commit(worktree, "README.md", "task side\n", "task edit");
	await f.commit(f.root, "README.md", "trunk side\n", "trunk edit");

	const exit = await bails(graft(f.arbor, worktree));

	expect(exit.reason).toBe("conflict");
	expect(exit.code).toBe(2);
	expect(f.out()).toContain("README.md");
	expect(await f.git(worktree, "status", "--porcelain")).toContain(
		"UU README.md",
	);
	expect((await f.arbor.store.find("alpha")).state?.graftAttempts).toBe(1);
	expect(await f.fs.exists(f.lockPath)).toBe(false);
	await f.cleanup();
});

test("tests failing after the rebase roll the branch back and leave trunk alone", async () => {
	const f = await fixture({ testCommand: "echo boom-from-tests; exit 1" });
	await create(f.arbor, "alpha");
	const worktree = (await f.arbor.store.find("alpha")).path;
	await f.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
	await f.commit(f.root, "trunk.txt", "trunk\n", "add trunk");
	const before = await f.git(worktree, "rev-parse", "HEAD");
	const trunkBefore = await f.git(f.root, "rev-parse", "main");

	const exit = await bails(graft(f.arbor, worktree));

	expect(exit.reason).toBe("tests_failed");
	expect(exit.code).toBe(3);
	expect(f.out()).toContain("boom-from-tests");
	expect(await f.git(worktree, "rev-parse", "HEAD")).toBe(before);
	expect(await f.git(f.root, "rev-parse", "main")).toBe(trunkBefore);
	expect(await f.fs.exists(f.lockPath)).toBe(false);
	await f.cleanup();
});

test("graft stops once the retry budget is spent", async () => {
	const f = await fixture({ graftRetryBudget: 2 });
	await create(f.arbor, "alpha");
	const worktree = await f.arbor.store.find("alpha");
	await worktree.save({ graftAttempts: 2 });

	const exit = await bails(graft(f.arbor, worktree.path));

	expect(exit.reason).toBe("budget_exhausted");
	expect(exit.code).toBe(5);
	expect(f.out()).toContain("arbor escalate");
	await f.cleanup();
});

test("graft refuses to land when the lease changed hands during the test run", async () => {
	const f = await fixture();
	const thief = join(f.root, "steal.js");
	const path = f.arbor.store.recordPath("alpha");
	await Bun.write(
		thief,
		`const s = JSON.parse(await Bun.file(${JSON.stringify(path)}).text());\n` +
			`s.lease = { pid: 999202, hostname: s.lease.hostname, heartbeatAt: new Date().toISOString() };\n` +
			`await Bun.write(${JSON.stringify(path)}, JSON.stringify(s));\n`,
	);
	f.arbor.config.testCommand = `bun ${thief}`;
	await create(f.arbor, "alpha");
	const worktree = (await f.arbor.store.find("alpha")).path;
	await f.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
	const trunkBefore = await f.git(f.root, "rev-parse", "main");

	const exit = await bails(graft(f.arbor, worktree));

	expect(exit.reason).toBe("lease_lost");
	expect(exit.code).toBe(4);
	expect(await f.git(f.root, "rev-parse", "main")).toBe(trunkBefore);
	expect(await f.fs.exists(f.lockPath)).toBe(false);
	await f.cleanup();
});

test("concurrent grafts serialize: one runs its tests and lands before the next starts", async () => {
	const f = await fixture();
	const trace = join(f.root, "trace.log");
	f.arbor.config.testCommand = `printf 'start-%s\\n' "$ARBOR_TASK" >> ${trace}; sleep 0.2; printf 'end-%s\\n' "$ARBOR_TASK" >> ${trace}`;

	await create(f.arbor, "alpha");
	await create(f.arbor, "beta");
	const alpha = (await f.arbor.store.find("alpha")).path;
	const beta = (await f.arbor.store.find("beta")).path;
	await f.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
	await f.commit(beta, "beta.txt", "beta\n", "add beta");

	await Promise.all([graft(f.arbor, alpha), graft(f.arbor, beta)]);

	const lines = (await f.fs.read(trace)).trim().split("\n");
	expect(lines).toHaveLength(4);
	// Never interleaved: whoever starts first also ends first.
	expect(lines[1]).toBe(`end-${lines[0]?.slice("start-".length)}`);
	expect(lines[3]).toBe(`end-${lines[2]?.slice("start-".length)}`);
	// Both landed, on a linear trunk.
	const log = await f.git(f.root, "log", "--oneline", "main");
	expect(log).toContain("add alpha");
	expect(log).toContain("add beta");
	expect(await f.git(f.root, "rev-list", "--count", "--merges", "main")).toBe(
		"0",
	);
	await f.cleanup();
}, 20_000);
