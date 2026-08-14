import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FileLock } from "@webappwiz/sys";
import { add } from "./add";
import { Git } from "./git";
import { merge } from "./merge";
import { Shell } from "./shell";
import { bails, LIVE_PID, repo, testConfig } from "./testing";
import { WorktreeService } from "./worktree-service";

/** A repo of its own per test, so merges in different tests can run at once. */
const setup = async () => {
	const fixture = await repo();
	const config = testConfig(fixture.root);
	const git = new Git(fixture.root, fixture.ps, fixture.fs);
	const service = new WorktreeService(
		git,
		config,
		fixture.arborDir,
		fixture.fs,
		fixture.ps,
	);
	await service.init();
	const lockPath = join(fixture.arborDir, "merge.lock");
	return {
		...fixture,
		config,
		git,
		service,
		shell: new Shell(fixture.ps),
		lockPath,
		lock: new FileLock(lockPath, fixture.fs, fixture.ps, fixture.log, {
			stalenessMs: config.leaseStalenessMs,
		}),
	};
};

describe.concurrent("merge", () => {
	it("rebases, tests, then fast-forwards trunk", async () => {
		await using deps = await setup();

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
		await using deps = await setup();

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
		await using deps = await setup();

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

	it("discards the landed task, so it drops out of the listing", async () => {
		await using deps = await setup();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await merge(deps, worktree);

		expect((await deps.service.find("alpha")).status).toBe("removed");
		expect(await deps.fs.exists(worktree)).toBe(false);
		expect(await deps.service.list()).toEqual([]);
	});

	it("refuses to run with uncommitted changes, before taking the lock", async () => {
		await using deps = await setup();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.write(join(worktree, "alpha.txt"), "not committed\n");

		const exit = await bails(merge(deps, worktree));

		expect(exit.reason).toBe("dirty");
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("leaves a conflicting rebase in progress for the agent to resolve", async () => {
		await using deps = await setup();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "README.md", "task side\n", "task edit");
		await deps.commit(deps.root, "README.md", "trunk side\n", "trunk edit");

		const exit = await bails(merge(deps, worktree));

		expect(exit.reason).toBe("conflict");
		expect(exit.message).toContain("README.md");
		expect(await deps.gitCli(worktree, "status", "--porcelain")).toContain(
			"UU README.md",
		);
		expect((await deps.service.find("alpha")).state?.mergeAttempts).toBe(1);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("rolls the branch back and leaves trunk alone when the gate fails", async () => {
		await using deps = await setup();

		deps.config.preMerge = "echo boom-from-tests; exit 1";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(deps.root, "trunk.txt", "trunk\n", "add trunk");
		const before = await deps.gitCli(worktree, "rev-parse", "HEAD");
		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");

		const exit = await bails(merge(deps, worktree));

		expect(exit.reason).toBe("tests_failed");
		expect(exit.message).toContain("boom-from-tests");
		expect(await deps.gitCli(worktree, "rev-parse", "HEAD")).toBe(before);
		expect(await deps.gitCli(deps.root, "rev-parse", "main")).toBe(trunkBefore);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("runs postRewrite before preMerge, and fails the gate when it does", async () => {
		await using deps = await setup();

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

		const exit = await bails(merge(deps, beta));

		expect(exit.reason).toBe("tests_failed");
		expect(exit.message).toContain("boom-from-hook");
		expect((await deps.service.find("beta")).state?.mergeAttempts).toBe(1);
	});

	it("stops once the retry budget is spent", async () => {
		await using deps = await setup();

		deps.config.mergeRetryCount = 2;
		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await worktree.save({ mergeAttempts: 2 });

		const exit = await bails(merge(deps, worktree.path));

		expect(exit.reason).toBe("budget_exhausted");
		expect(exit.message).toContain("arbor escalate");
	});

	it("refuses to land when the lease changed hands during the test run", async () => {
		await using deps = await setup();

		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await deps.commit(worktree.path, "alpha.txt", "alpha\n", "add alpha");
		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");
		// Another agent takes the tree while the tests are running: the one
		// window merge cannot hold the record across, and the reason it re-reads
		// it before landing.
		deps.shell.run = async () => {
			await worktree.save({
				lease: {
					pid: LIVE_PID,
					hostname: deps.ps.hostname,
					heartbeatAt: new Date().toISOString(),
				},
			});
			return { exitCode: 0, stdout: "", stderr: "" };
		};

		const exit = await bails(merge(deps, worktree.path));

		expect(exit.reason).toBe("lease_lost");
		expect(await deps.gitCli(deps.root, "rev-parse", "main")).toBe(trunkBefore);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("serializes: one merge runs its tests and lands before the next starts", async () => {
		await using deps = await setup();

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
		// Never interleaved: whoever starts first also ends first.
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
