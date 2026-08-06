import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FileLock } from "@webappwiz/sys";
import type { Config } from "../lib/config";
import { Failures } from "../lib/failures";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { bails, raised, repo, testConfig } from "../lib/testing";
import { WorktreeStore } from "../lib/worktree-store";
import { create } from "./create";
import { graft } from "./graft";

/** Called per test rather than once per describe: these run concurrently. */
async function setup(overrides: Partial<Config> = {}) {
	const r = await repo();
	const config = testConfig(r.root, overrides);
	const git = new Git(r.ps, r.fs, r.root);
	const store = new WorktreeStore(r.fs, r.ps, git, config, r.arborDir);
	await store.init();
	const failures = new Failures();
	const lockPath = join(r.arborDir, "graft.lock");
	return {
		...r,
		config,
		git,
		store,
		shell: new Shell(r.ps),
		lockPath,
		lock: new FileLock(r.fs, r.ps, r.log, lockPath, {
			stalenessMs: config.leaseStalenessMs,
		}),
		failures,
		raised: raised(failures),
	};
}

describe("graft", () => {
	test("rebases, tests, then fast-forwards trunk", async () => {
		const d = await setup();
		await create(d, d.failures, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		// Trunk moved on underneath, so the rebase has real work to do.
		await d.commit(d.root, "trunk.txt", "trunk\n", "add trunk");

		await graft(d, d.failures, worktree);

		expect(await d.gitCli(d.root, "log", "--oneline", "main")).toContain(
			"add alpha",
		);
		expect(
			await d.gitCli(d.root, "rev-list", "--count", "--merges", "main"),
		).toBe("0");
		expect(await d.gitCli(d.root, "rev-parse", "main")).toBe(
			await d.gitCli(worktree, "rev-parse", "task/alpha"),
		);
		expect(await d.fs.exists(d.lockPath)).toBe(false);
		expect((await d.store.find("alpha")).state?.graftAttempts).toBe(0);
		await d.cleanup();
	});

	test("refuses to run with uncommitted changes, before taking the lock", async () => {
		const d = await setup();
		await create(d, d.failures, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.fs.write(join(worktree, "alpha.txt"), "not committed\n");

		const exit = await bails(graft(d, d.failures, worktree));

		expect(exit.reason).toBe("dirty");
		expect(exit.code).toBe(7);
		expect(await d.fs.exists(d.lockPath)).toBe(false);
		await d.cleanup();
	});

	test("leaves a conflicting rebase in progress for the agent to resolve", async () => {
		const d = await setup();
		await create(d, d.failures, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "README.md", "task side\n", "task edit");
		await d.commit(d.root, "README.md", "trunk side\n", "trunk edit");

		const exit = await bails(graft(d, d.failures, worktree));

		expect(exit.reason).toBe("conflict");
		expect(exit.code).toBe(2);
		expect(d.raised.at(-1)?.message).toContain("README.md");
		expect(await d.gitCli(worktree, "status", "--porcelain")).toContain(
			"UU README.md",
		);
		expect((await d.store.find("alpha")).state?.graftAttempts).toBe(1);
		expect(await d.fs.exists(d.lockPath)).toBe(false);
		await d.cleanup();
	});

	test("rolls the branch back and leaves trunk alone when tests fail", async () => {
		const d = await setup({ testCommand: "echo boom-from-tests; exit 1" });
		await create(d, d.failures, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await d.commit(d.root, "trunk.txt", "trunk\n", "add trunk");
		const before = await d.gitCli(worktree, "rev-parse", "HEAD");
		const trunkBefore = await d.gitCli(d.root, "rev-parse", "main");

		const exit = await bails(graft(d, d.failures, worktree));

		expect(exit.reason).toBe("tests_failed");
		expect(exit.code).toBe(3);
		expect(d.raised.at(-1)?.message).toContain("boom-from-tests");
		expect(await d.gitCli(worktree, "rev-parse", "HEAD")).toBe(before);
		expect(await d.gitCli(d.root, "rev-parse", "main")).toBe(trunkBefore);
		expect(await d.fs.exists(d.lockPath)).toBe(false);
		await d.cleanup();
	});

	test("stops once the retry budget is spent", async () => {
		const d = await setup({ graftRetryBudget: 2 });
		await create(d, d.failures, "alpha");
		const worktree = await d.store.find("alpha");
		await worktree.save({ graftAttempts: 2 });

		const exit = await bails(graft(d, d.failures, worktree.path));

		expect(exit.reason).toBe("budget_exhausted");
		expect(exit.code).toBe(5);
		expect(d.raised.at(-1)?.message).toContain("arbor escalate");
		await d.cleanup();
	});

	test("refuses to land when the lease changed hands during the test run", async () => {
		const d = await setup();
		const thief = join(d.root, "steal.js");
		const path = d.store.recordPath("alpha");
		await Bun.write(
			thief,
			`const s = JSON.parse(await Bun.file(${JSON.stringify(path)}).text());\n` +
				`s.lease = { pid: 999202, hostname: s.lease.hostname, heartbeatAt: new Date().toISOString() };\n` +
				`await Bun.write(${JSON.stringify(path)}, JSON.stringify(s));\n`,
		);
		d.config.testCommand = `bun ${thief}`;
		await create(d, d.failures, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		const trunkBefore = await d.gitCli(d.root, "rev-parse", "main");

		const exit = await bails(graft(d, d.failures, worktree));

		expect(exit.reason).toBe("lease_lost");
		expect(exit.code).toBe(4);
		expect(await d.gitCli(d.root, "rev-parse", "main")).toBe(trunkBefore);
		expect(await d.fs.exists(d.lockPath)).toBe(false);
		await d.cleanup();
	});

	test("serializes: one graft runs its tests and lands before the next starts", async () => {
		const d = await setup();
		const trace = join(d.root, "trace.log");
		d.config.testCommand = `printf 'start-%s\\n' "$ARBOR_TASK" >> ${trace}; sleep 0.2; printf 'end-%s\\n' "$ARBOR_TASK" >> ${trace}`;

		await create(d, d.failures, "alpha");
		await create(d, d.failures, "beta");
		const alpha = (await d.store.find("alpha")).path;
		const beta = (await d.store.find("beta")).path;
		await d.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		await d.commit(beta, "beta.txt", "beta\n", "add beta");

		await Promise.all([
			graft(d, d.failures, alpha),
			graft(d, d.failures, beta),
		]);

		const lines = (await d.fs.read(trace)).trim().split("\n");
		expect(lines).toHaveLength(4);
		// Never interleaved: whoever starts first also ends first.
		expect(lines[1]).toBe(`end-${lines[0]?.slice("start-".length)}`);
		expect(lines[3]).toBe(`end-${lines[2]?.slice("start-".length)}`);
		// Both landed, on a linear trunk.
		const log = await d.gitCli(d.root, "log", "--oneline", "main");
		expect(log).toContain("add alpha");
		expect(log).toContain("add beta");
		expect(
			await d.gitCli(d.root, "rev-list", "--count", "--merges", "main"),
		).toBe("0");
		await d.cleanup();
	}, 20_000);
});
