import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import type { Facts } from "../records";
import { add } from "../tasks";
import { Testing } from "../testing";
import { merge } from "./merge";

// Every test here drives real git in a repo of its own, dozens of processes
// each: fast alone, but starved past bun's 5s default when the whole suite
// runs in parallel on a busy machine.
setDefaultTimeout(30_000);

describe.concurrent("merge, gating and refusals", () => {
	it("refuses to run with uncommitted changes, before taking the lock", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.write(join(worktree, "alpha.txt"), "not committed\n");

		await deps.finish(worktree);
		await expect(merge(deps, worktree)).toBail("dirty");
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("leaves a conflicting rebase in progress for the agent to resolve", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "README.md", "task side\n", "task edit");
		await deps.commit(deps.root, "README.md", "trunk side\n", "trunk edit");

		await deps.finish(worktree);
		await expect(merge(deps, worktree)).toBail("conflict", {
			message: "README.md",
		});
		expect(await deps.gitCli(worktree, "status", "--porcelain")).toContain(
			"UU README.md",
		);
		expect((await deps.service.find("alpha")).state).toMatchObject({
			mergeAttempts: 0,
			conflictAttempts: 1,
		});
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("stops on a conflict before waiting for a premerge lock another merge holds", async () => {
		await using deps = await Testing.open();
		deps.config.preMerge = "true";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "README.md", "task side\n", "task edit");
		await deps.commit(deps.root, "README.md", "trunk side\n", "trunk edit");
		await deps.finish(worktree);
		await Bun.spawn(["mkdir", "-p", deps.premerge.path]).exited;

		await expect(merge(deps, worktree)).toBail("conflict", {
			message: "README.md",
		});
		expect((await deps.service.find("alpha")).state?.conflictAttempts).toBe(1);
		expect(await deps.fs.exists(deps.premerge.path)).toBe(true);
	});

	// vet-ignore simple-test-setup: these tests run concurrently, each on deps of its own, so there is no beforeEach to share it
	it.each(["task", "base"])(
		"preserves a %s index lock without spending an attempt",
		async (where) => {
			// vet-ignore simple-test-setup: each concurrent case owns a separate repo, as the cases around it do.
			await using deps = await Testing.open();
			await add(deps, "alpha");
			const worktree = (await deps.service.find("alpha")).path;
			await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
			await deps.commit(deps.root, "trunk.txt", "trunk\n", "add trunk");
			await deps.finish(worktree);
			const trunkBefore = await deps.git.head(deps.root);
			const dir = await deps.gitCli(
				where === "task" ? worktree : deps.root,
				"rev-parse",
				"--absolute-git-dir",
			);
			const path = join(dir, "index.lock");
			// Keep the lock open as a live writer would. Only this owner removes it.
			const { open, unlink } = await import("node:fs/promises");
			const owner = await open(path, "wx");
			try {
				await owner.writeFile("owned by the test");
				const facts = {};
				await expect(merge(deps, worktree, facts)).toBail("blocked", {
					message: "lock contention",
				});
				expect(await deps.fs.read(path)).toBe("owned by the test");
				const task = await deps.service.find("alpha");
				expect(task.mergeAttempts).toBe(0);
				expect(task.status).toBe("working");
				expect(task.state?.gateFailures ?? []).toEqual([]);
				expect(await deps.git.head(deps.root)).toBe(trunkBefore);
				expect(await deps.fs.exists(deps.lockPath)).toBe(false);
			} finally {
				await owner.close();
				await unlink(path);
			}
			await merge(deps, worktree);
			expect((await deps.service.find("alpha")).status).toBe("removed");
		},
	);

	it("says why a rebase failed that left no file in conflict", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(deps.root, "trunk.txt", "trunk\n", "add trunk");
		const hooks = join(
			await deps.gitCli(worktree, "rev-parse", "--git-common-dir"),
			"hooks",
		);
		await deps.fs.write(
			join(hooks, "pre-rebase"),
			"#!/bin/sh\necho refused-by-hook >&2\nexit 1\n",
		);
		await deps.gitCli(worktree, "config", "core.hooksPath", hooks);
		await Bun.spawn(["chmod", "+x", join(hooks, "pre-rebase")]).exited;

		await deps.finish(worktree);
		const facts: Partial<Facts["merge"]> = {};
		await expect(merge(deps, worktree, facts)).toBail("merge_failed", {
			message: "no file in conflict",
		});
		expect(
			(await deps.service.find("alpha")).state?.gateFailures?.at(-1)?.output,
		).toContain("refused-by-hook");
		expect(facts.output).toContain("refused-by-hook");
	});

	it("refuses a failing preLock check before the premerge lock is taken, and hands the gate the commit it passed on", async () => {
		await using deps = await Testing.open();

		deps.config.preLock = "echo bad-check; exit 1";
		deps.config.preMerge = "touch gate-ran";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);
		await expect(merge(deps, worktree)).toBail("checks_failed", {
			message: ["bad-check"],
		});
		expect(await deps.fs.exists(join(worktree, "gate-ran"))).toBe(false);
		expect(await deps.fs.exists(deps.premerge.path)).toBe(false);
		// What the checks printed as they ran, for the merge card to open.
		const gitDir = await deps.gitCli(
			worktree,
			"rev-parse",
			"--absolute-git-dir",
		);
		expect(await deps.fs.read(`${gitDir}/splates-merge-1-check.log`)).toBe(
			"bad-check\n",
		);

		deps.config.preLock = "true";
		deps.config.preMerge = 'git rev-parse HEAD | grep -q "$SPLATES_CHECKED"';
		await merge(deps, worktree);
	});

	it("leaves the branch rebased on the tested trunk and trunk alone when the gate fails", async () => {
		await using deps = await Testing.open();

		deps.config.preMerge = "echo boom-from-tests; exit 1";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(deps.root, "trunk.txt", "trunk\n", "add trunk");
		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");

		await deps.finish(worktree);
		const facts: Partial<Facts["merge"]> = {};
		await expect(merge(deps, worktree, facts)).toBail("tests_failed", {
			message: [
				"boom-from-tests",
				`now rebased onto main@${trunkBefore.slice(0, 8)}`,
			],
		});
		// It named no test, so what the gate printed is all there is to show.
		expect(facts.output).toBe("boom-from-tests");
		const gitDir = await deps.gitCli(
			worktree,
			"rev-parse",
			"--absolute-git-dir",
		);
		const printed = (await deps.fs.readdir(gitDir)).filter((name) =>
			/^splates-merge-\d+-test\.log$/.test(name),
		);
		expect(printed).toHaveLength(1);
		expect(await deps.fs.read(`${gitDir}/${printed[0]}`)).toBe(
			"boom-from-tests\n",
		);
		expect(await deps.gitCli(worktree, "rev-parse", "HEAD~1")).toBe(
			trunkBefore,
		);
		expect(await deps.fs.exists(join(worktree, "trunk.txt"))).toBe(true);
		expect(await deps.gitCli(deps.root, "rev-parse", "main")).toBe(trunkBefore);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("names the failing tests after the tail, where a read of its end finds them", async () => {
		await using deps = await Testing.open();

		deps.config.preMerge =
			"printf '(fail) a > b [1.2ms]\\n'; yes noise | head -60; echo '1 fail'; exit 1";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await deps.finish(worktree);
		await expect(merge(deps, worktree)).toBail("tests_failed", {
			message: [
				"noise\n1 fail\n\n`printf",
				"Failing tests (1):\na > b\n\nFix what broke",
			],
		});
	});

	it("keeps what each failing test said beside its name", async () => {
		await using deps = await Testing.open();

		deps.config.preMerge =
			"printf 'noise\\nExpected: 1\\nReceived: 2\\n(fail) a > b [1.2ms]\\n'; exit 1";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await deps.finish(worktree);
		const facts: Partial<Facts["merge"]> = {};
		await expect(merge(deps, worktree, facts)).toBail("tests_failed", {
			message: "a > b\n    noise\n    Expected: 1\n    Received: 2\n",
		});
		expect(facts.output).toBeUndefined();
	});

	it("keeps the timeout note bun prints after a timed-out test's name", async () => {
		await using deps = await Testing.open();

		deps.config.preMerge =
			"printf 'An update to Conversation was not wrapped in act(...)\\n(fail) a > b [30000.1ms]\\n  ^ this test timed out after 30000ms.\\n'; exit 1";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await deps.finish(worktree);
		await expect(merge(deps, worktree)).toBail("tests_failed", {
			message:
				"a > b\n    An update to Conversation was not wrapped in act(...)\n    ^ this test timed out after 30000ms.\n",
		});
	});

	it("kills a gate that runs past its timeout, refusing without spending an attempt", async () => {
		await using deps = await Testing.open();
		deps.config.preMerge = "sleep 10";
		const facts: Partial<Facts["merge"]> = {};

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(deps.root, "trunk.txt", "trunk\n", "add trunk");
		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");
		await deps.finish(worktree);

		await expect(
			merge({ ...deps, gateTimeoutMs: 100 }, worktree, facts),
		).toBail("timeout", {
			message: `now rebased onto main@${trunkBefore.slice(0, 8)}`,
		});
		expect(await deps.gitCli(worktree, "rev-parse", "HEAD~1")).toBe(
			trunkBefore,
		);
		expect(facts.attemptsLeft).toBe(deps.config.mergeRetryCount);
		expect((await deps.service.find("alpha")).state?.gate).toBeUndefined();
		expect(await deps.fs.exists(join(deps.root, "alpha.txt"))).toBe(false);
		expect(await deps.fs.exists(deps.premerge.path)).toBe(false);
	});
});
