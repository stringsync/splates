import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { merge } from "./merge";
import { PLAN_FILE } from "./plans";
import { add, checkpoint, escalate, remove, WIP_MESSAGE } from "./tasks";
import { Testing } from "./testing";

describe("TaskBranches", () => {
	let deps: Testing;
	let remote: string;
	let tree: string;

	beforeEach(async () => {
		deps = await Testing.open();
		remote = join(deps.config.worktreeRoot, "..", "remote.git");
		await deps.gitCli(deps.root, "init", "--bare", remote);
		await deps.gitCli(deps.root, "remote", "add", "origin", remote);
		// A merge lands on the remote's trunk, so it has one.
		await deps.gitCli(deps.root, "push", "--quiet", "origin", "main");
		deps.config.remote = "origin";
		await add(deps, "alpha");
		tree = (await deps.service.find("alpha")).path;
	});

	afterEach(() => deps.disposeAsync());

	/** The commit the remote has as `splates/alpha`, or null when it has none. */
	const pushed = async (): Promise<string | null> => {
		const { exitCode, stdout } = await deps.ps.spawnCapture([
			"git",
			"-C",
			remote,
			"rev-parse",
			"--verify",
			"--quiet",
			"refs/heads/splates/alpha",
		]);
		return exitCode === 0 ? stdout.trim() : null;
	};
	const tip = () => deps.gitCli(tree, "rev-parse", "HEAD");

	it("pushes a task's branch as splates/<task>, and again once rewritten", async () => {
		await deps.commit(tree, "a.txt", "one\n", "a");
		expect(await deps.branches.push("alpha", "task/alpha")).toEqual({
			status: "pushed",
			branch: "splates/alpha",
		});
		expect(await pushed()).toBe(await tip());

		await deps.gitCli(tree, "commit", "--amend", "-m", "a, amended");
		await deps.branches.push("alpha", "task/alpha");
		expect(await pushed()).toBe(await tip());
	});

	it("pushes nothing with no remote configured", async () => {
		deps.config.remote = null;
		await deps.commit(tree, "a.txt", "one\n", "a");

		expect(await deps.branches.push("alpha", "task/alpha")).toEqual({
			status: "off",
		});
		expect(await pushed()).toBe(null);
	});

	it("never pushes a branch that tracks the plan", async () => {
		await deps.fs.write(join(tree, PLAN_FILE), "# alpha\n");
		await deps.gitCli(tree, "add", "--force", PLAN_FILE);
		await deps.gitCli(tree, "commit", "-m", "the plan, by mistake");

		expect(await deps.branches.push("alpha", "task/alpha")).toMatchObject({
			status: "refused",
			why: expect.stringContaining(`tracks ${PLAN_FILE}`),
		});
		expect(await pushed()).toBe(null);
	});

	it("deletes the pushed branch, and one already gone", async () => {
		await deps.commit(tree, "a.txt", "one\n", "a");
		await deps.branches.push("alpha", "task/alpha");

		expect((await deps.branches.delete("alpha")).status).toBe("pushed");
		expect(await pushed()).toBe(null);
		expect((await deps.branches.delete("alpha")).status).toBe("pushed");
	});

	it("checkpoints uncommitted work as a WIP commit, leaving the plan out", async () => {
		await deps.commit(tree, "a.txt", "one\n", "a");
		await deps.fs.write(join(tree, "half.txt"), "half done\n");
		await deps.fs.write(join(tree, PLAN_FILE), "# alpha\n");

		expect(await checkpoint(deps, tree)).toEqual({
			task: "alpha",
			committed: true,
			pushed: true,
		});
		expect(await deps.gitCli(tree, "log", "-1", "--format=%s")).toBe(
			WIP_MESSAGE,
		);
		expect(await deps.gitCli(tree, "status", "--porcelain")).toBe("");
		expect(await pushed()).toBe(await tip());
		expect(
			await deps.git.tracked("refs/heads/task/alpha", [PLAN_FILE, "half.txt"]),
		).toEqual(["half.txt"]);
	});

	it("leaves the tree as it is at a checkpoint with no remote", async () => {
		deps.config.remote = null;
		await deps.fs.write(join(tree, "half.txt"), "half done\n");

		expect((await checkpoint(deps, tree)).committed).toBe(false);
		expect(await deps.gitCli(tree, "status", "--porcelain")).toBe(
			"?? half.txt",
		);
	});

	it("pushes what an escalation leaves, without committing the tree", async () => {
		await deps.commit(tree, "a.txt", "one\n", "a");
		await deps.fs.write(join(tree, "half.txt"), "half done\n");

		await escalate(deps, "needs a human", tree);

		expect(await pushed()).toBe(await tip());
		expect(await deps.gitCli(tree, "status", "--porcelain")).toBe(
			"?? half.txt",
		);
	});

	it("deletes the pushed branch once the task merges", async () => {
		await deps.commit(tree, "a.txt", "one\n", "a");
		await deps.branches.push("alpha", "task/alpha");
		await deps.finish(tree);

		await merge(deps, tree);

		expect(await pushed()).toBe(null);
		expect(deps.out()).toContain("deleted splates/alpha");
	});

	it("deletes the pushed branch once the task is removed", async () => {
		await deps.commit(tree, "a.txt", "one\n", "a");
		await deps.branches.push("alpha", "task/alpha");

		await remove(deps, "alpha");

		expect(await pushed()).toBe(null);
	});

	it("refuses to merge a branch that tracks the plan", async () => {
		await deps.fs.write(join(tree, PLAN_FILE), "# alpha\n");
		await deps.gitCli(tree, "add", "--force", PLAN_FILE);
		await deps.gitCli(tree, "commit", "-m", "the plan, by mistake");

		await expect(merge(deps, tree)).toBail("blocked", {
			message: `tracks ${PLAN_FILE}`,
		});
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
	});
});
