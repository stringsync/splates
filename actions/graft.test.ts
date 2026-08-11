import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FileLock } from "@webappwiz/sys";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { bails, LIVE_PID, repo, testConfig } from "../lib/testing";
import { WorktreeStore } from "../lib/worktree-store";
import { create } from "./create";
import { graft } from "./graft";

/** A repo of its own per test, so grafts in different tests can run at once. */
const setup = async () => {
	const r = await repo();
	const config = testConfig(r.root);
	const git = new Git(r.ps, r.fs, r.root);
	const store = new WorktreeStore(r.fs, r.ps, git, config, r.arborDir);
	await store.init();
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
	};
};

describe.concurrent("graft", () => {
	it("rebases, tests, then fast-forwards trunk", async () => {
		await using d = await setup();

		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		// Trunk moved on underneath, so the rebase has real work to do.
		await d.commit(d.root, "trunk.txt", "trunk\n", "add trunk");

		await graft(d, worktree);

		expect(await d.gitCli(d.root, "log", "--oneline", "main")).toContain(
			"add alpha",
		);
		expect(
			await d.gitCli(d.root, "rev-list", "--count", "--merges", "main"),
		).toBe("0");
		expect(await d.fs.exists(d.lockPath)).toBe(false);
	});

	it("discards the landed task, so it drops out of the listing", async () => {
		await using d = await setup();

		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await graft(d, worktree);

		expect((await d.store.find("alpha")).status).toBe("pruned");
		expect(await d.fs.exists(worktree)).toBe(false);
		expect(await d.store.list()).toEqual([]);
	});

	it("refuses to run with uncommitted changes, before taking the lock", async () => {
		await using d = await setup();

		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.fs.write(join(worktree, "alpha.txt"), "not committed\n");

		const exit = await bails(graft(d, worktree));

		expect(exit.reason).toBe("dirty");
		expect(await d.fs.exists(d.lockPath)).toBe(false);
	});

	it("leaves a conflicting rebase in progress for the agent to resolve", async () => {
		await using d = await setup();

		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "README.md", "task side\n", "task edit");
		await d.commit(d.root, "README.md", "trunk side\n", "trunk edit");

		const exit = await bails(graft(d, worktree));

		expect(exit.reason).toBe("conflict");
		expect(exit.message).toContain("README.md");
		expect(await d.gitCli(worktree, "status", "--porcelain")).toContain(
			"UU README.md",
		);
		expect((await d.store.find("alpha")).state?.graftAttempts).toBe(1);
		expect(await d.fs.exists(d.lockPath)).toBe(false);
	});

	it("rolls the branch back and leaves trunk alone when tests fail", async () => {
		await using d = await setup();

		d.config.testCommand = "echo boom-from-tests; exit 1";
		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await d.commit(d.root, "trunk.txt", "trunk\n", "add trunk");
		const before = await d.gitCli(worktree, "rev-parse", "HEAD");
		const trunkBefore = await d.gitCli(d.root, "rev-parse", "main");

		const exit = await bails(graft(d, worktree));

		expect(exit.reason).toBe("tests_failed");
		expect(exit.message).toContain("boom-from-tests");
		expect(await d.gitCli(worktree, "rev-parse", "HEAD")).toBe(before);
		expect(await d.gitCli(d.root, "rev-parse", "main")).toBe(trunkBefore);
		expect(await d.fs.exists(d.lockPath)).toBe(false);
	});

	it("stops once the retry budget is spent", async () => {
		await using d = await setup();

		d.config.graftRetryCount = 2;
		await create(d, "alpha");
		const worktree = await d.store.find("alpha");
		await worktree.save({ graftAttempts: 2 });

		const exit = await bails(graft(d, worktree.path));

		expect(exit.reason).toBe("budget_exhausted");
		expect(exit.message).toContain("arbor escalate");
	});

	it("refuses to land when the lease changed hands during the test run", async () => {
		await using d = await setup();

		await create(d, "alpha");
		const worktree = await d.store.find("alpha");
		await d.commit(worktree.path, "alpha.txt", "alpha\n", "add alpha");
		const trunkBefore = await d.gitCli(d.root, "rev-parse", "main");
		// Another agent takes the tree while the tests are running: the one
		// window graft cannot hold the record across, and the reason it re-reads
		// it before landing.
		d.shell.run = async () => {
			await worktree.save({
				lease: {
					pid: LIVE_PID,
					hostname: d.ps.hostname,
					heartbeatAt: new Date().toISOString(),
				},
			});
			return { exitCode: 0, stdout: "", stderr: "" };
		};

		const exit = await bails(graft(d, worktree.path));

		expect(exit.reason).toBe("lease_lost");
		expect(await d.gitCli(d.root, "rev-parse", "main")).toBe(trunkBefore);
		expect(await d.fs.exists(d.lockPath)).toBe(false);
	});

	it("serializes: one graft runs its tests and lands before the next starts", async () => {
		await using d = await setup();

		const trace = join(d.root, "trace.log");
		d.config.testCommand = `printf 'start-%s\\n' "$ARBOR_TASK" >> ${trace}; sleep 0.2; printf 'end-%s\\n' "$ARBOR_TASK" >> ${trace}`;

		await create(d, "alpha");
		await create(d, "beta");
		const alpha = (await d.store.find("alpha")).path;
		const beta = (await d.store.find("beta")).path;
		await d.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		await d.commit(beta, "beta.txt", "beta\n", "add beta");

		await Promise.all([graft(d, alpha), graft(d, beta)]);

		const lines = (await d.fs.read(trace)).trim().split("\n");
		expect(lines).toHaveLength(4);
		// Never interleaved: whoever starts first also ends first.
		expect(lines[1]).toBe(`end-${lines[0]?.slice("start-".length)}`);
		expect(lines[3]).toBe(`end-${lines[2]?.slice("start-".length)}`);
		const log = await d.gitCli(d.root, "log", "--oneline", "main");
		expect(log).toContain("add alpha");
		expect(log).toContain("add beta");
		expect(
			await d.gitCli(d.root, "rev-list", "--count", "--merges", "main"),
		).toBe("0");
	}, 20_000);
});
