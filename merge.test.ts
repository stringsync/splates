import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FakePs } from "webappwiz/system/testing";
import { add } from "./add";
import { merge } from "./merge";
import { Shell } from "./shell";
import { LIVE_PID, Testing } from "./testing";

describe.concurrent("merge", () => {
	it("rebases, tests, then fast-forwards trunk", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		// Trunk moved on underneath, so the rebase has real work to do.
		await deps.commit(deps.root, "trunk.txt", "trunk\n", "add trunk");

		await merge(deps, worktree);

		expect(await deps.gitCli(deps.root, "log", "--oneline", "main")).toContain(
			"add alpha",
		);
		expect(
			await deps.gitCli(deps.root, "rev-list", "--count", "--merges", "main"),
		).toBe("0");
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("lands on a clean rebase alone when no hook is configured", async () => {
		await using deps = await Testing.open();

		deps.config.postRewrite = null;
		deps.config.preMerge = null;
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await merge(deps, worktree);

		expect(await deps.gitCli(deps.root, "log", "--oneline", "main")).toContain(
			"add alpha",
		);
	});

	it("lands a --base task on its base branch and leaves trunk alone", async () => {
		await using deps = await Testing.open();

		await deps.gitCli(deps.root, "branch", "feature", "main");
		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");
		await add(deps, "alpha", { base: "feature" });
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await merge(deps, worktree);

		expect(
			await deps.gitCli(deps.root, "log", "--oneline", "feature"),
		).toContain("add alpha");
		expect(await deps.gitCli(deps.root, "rev-parse", "main")).toBe(trunkBefore);
	});

	it("lands into the worktree that holds the base, leaving trunk alone", async () => {
		await using deps = await Testing.open();

		await add(deps, "parent");
		const parent = (await deps.service.find("parent")).path;
		await deps.commit(parent, "parent.txt", "parent\n", "add parent");
		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");

		await add(deps, "child", { base: "task/parent" });
		const child = (await deps.service.find("child")).path;
		await deps.commit(child, "child.txt", "child\n", "add child");

		await merge(deps, child);

		// The parent's files move with its branch, not just the ref: a ref moved
		// behind a worktree's back leaves it reading the landed files as deleted.
		expect(await deps.fs.exists(join(parent, "child.txt"))).toBe(true);
		expect(await deps.gitCli(parent, "log", "--oneline", "HEAD")).toContain(
			"add child",
		);
		expect(await deps.gitCli(deps.root, "rev-parse", "main")).toBe(trunkBefore);
	});

	it("refuses to land into a base worktree whose changes collide", async () => {
		await using deps = await Testing.open();

		await add(deps, "parent");
		const parent = (await deps.service.find("parent")).path;
		await add(deps, "child", { base: "task/parent" });
		const child = (await deps.service.find("child")).path;
		await deps.commit(child, "shared.txt", "child\n", "add shared");
		// The parent is mid-edit on the very file the child is about to land.
		await deps.fs.write(join(parent, "shared.txt"), "parent still editing\n");

		await expect(merge(deps, child)).toBail("merge_failed", {
			message: parent,
		});
		expect((await deps.service.find("child")).state?.mergeAttempts).toBe(1);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("discards the landed task, so it drops out of the listing", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await merge(deps, worktree);

		expect((await deps.service.find("alpha")).status).toBe("removed");
		expect(await deps.fs.exists(worktree)).toBe(false);
		expect(await deps.service.list()).toEqual([]);
	});

	it("refuses to run with uncommitted changes, before taking the lock", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.write(join(worktree, "alpha.txt"), "not committed\n");

		await expect(merge(deps, worktree)).toBail("dirty");
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("leaves a conflicting rebase in progress for the agent to resolve", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "README.md", "task side\n", "task edit");
		await deps.commit(deps.root, "README.md", "trunk side\n", "trunk edit");

		await expect(merge(deps, worktree)).toBail("conflict", {
			message: "README.md",
		});
		expect(await deps.gitCli(worktree, "status", "--porcelain")).toContain(
			"UU README.md",
		);
		expect((await deps.service.find("alpha")).state?.mergeAttempts).toBe(1);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("rolls the branch back and leaves trunk alone when the gate fails", async () => {
		await using deps = await Testing.open();

		deps.config.preMerge = "echo boom-from-tests; exit 1";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(deps.root, "trunk.txt", "trunk\n", "add trunk");
		const before = await deps.gitCli(worktree, "rev-parse", "HEAD");
		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");

		await expect(merge(deps, worktree)).toBail("tests_failed", {
			message: "boom-from-tests",
		});
		expect(await deps.gitCli(worktree, "rev-parse", "HEAD")).toBe(before);
		expect(await deps.gitCli(deps.root, "rev-parse", "main")).toBe(trunkBefore);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("runs postRewrite before preMerge, and fails the gate when it does", async () => {
		await using deps = await Testing.open();

		// Only passes if the hook ran first, in the same tree, before preMerge.
		deps.config.postRewrite = "echo hooked > hook.txt";
		deps.config.preMerge = "grep -q hooked hook.txt";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await merge(deps, worktree);
		expect(await deps.gitCli(deps.root, "log", "-1", "--format=%s")).toBe(
			"add alpha",
		);

		deps.config.postRewrite = "echo boom-from-hook; exit 1";
		await add(deps, "beta");
		const beta = (await deps.service.find("beta")).path;
		await deps.commit(beta, "beta.txt", "beta\n", "add beta");

		await expect(merge(deps, beta)).toBail("tests_failed", {
			message: "boom-from-hook",
		});
		expect((await deps.service.find("beta")).state?.mergeAttempts).toBe(1);
	});

	it("runs postMerge in the main tree after landing", async () => {
		await using deps = await Testing.open();

		deps.config.postMerge = 'echo "$ARBOR_TASK" > post-merge.txt';
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await merge(deps, worktree);

		expect(await deps.fs.read(join(deps.root, "post-merge.txt"))).toBe(
			"alpha\n",
		);
	});

	it("reports a failed postMerge without disturbing the landed branch", async () => {
		await using deps = await Testing.open();

		deps.config.postMerge = "echo boom-after-land; exit 1";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await expect(merge(deps, worktree)).toBail("hook_failed", {
			message: "boom-after-land",
		});
		expect(await deps.gitCli(deps.root, "log", "--oneline", "main")).toContain(
			"add alpha",
		);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("stops once the retry budget is spent", async () => {
		await using deps = await Testing.open();

		deps.config.mergeRetryCount = 2;
		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await worktree.save({ mergeAttempts: 2 });

		await expect(merge(deps, worktree.path)).toBail("budget_exhausted", {
			message: "arbor escalate",
		});
	});

	it("refuses to land when the lease changed hands during the test run", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await deps.commit(worktree.path, "alpha.txt", "alpha\n", "add alpha");
		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");
		// Another agent takes the tree while the tests are running: the one
		// window merge cannot hold the record across, and the reason it re-reads
		// it before landing.
		const ps = new FakePs();
		ps.simulate(async () => {
			await worktree.save({
				lease: {
					pid: LIVE_PID,
					hostname: deps.ps.hostname,
					heartbeatAt: new Date().toISOString(),
				},
			});
			return 0;
		});

		await expect(
			merge({ ...deps, shell: new Shell({ ps }) }, worktree.path),
		).toBail("lease_lost");
		expect(await deps.gitCli(deps.root, "rev-parse", "main")).toBe(trunkBefore);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("serializes: one merge runs its tests and lands before the next starts", async () => {
		await using deps = await Testing.open();

		const trace = join(deps.root, "trace.log");
		deps.config.preMerge = `printf 'start-%s\\n' "$ARBOR_TASK" >> ${trace}; sleep 0.2; printf 'end-%s\\n' "$ARBOR_TASK" >> ${trace}`;

		await add(deps, "alpha");
		await add(deps, "beta");
		const alpha = (await deps.service.find("alpha")).path;
		const beta = (await deps.service.find("beta")).path;
		await deps.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(beta, "beta.txt", "beta\n", "add beta");

		await Promise.all([merge(deps, alpha), merge(deps, beta)]);

		const lines = (await deps.fs.read(trace)).trim().split("\n");
		expect(lines).toHaveLength(4);
		// Merges hold the lock exclusively, so the second can't start until the first ends.
		expect(lines[1]).toBe(`end-${lines[0]?.slice("start-".length)}`);
		expect(lines[3]).toBe(`end-${lines[2]?.slice("start-".length)}`);
		const log = await deps.gitCli(deps.root, "log", "--oneline", "main");
		expect(log).toContain("add alpha");
		expect(log).toContain("add beta");
		expect(
			await deps.gitCli(deps.root, "rev-list", "--count", "--merges", "main"),
		).toBe("0");
	}, 20_000);
});
