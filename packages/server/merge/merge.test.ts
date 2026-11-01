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

describe.concurrent("merge", () => {
	it("rebases, tests, then fast-forwards trunk", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		// Trunk moved on underneath, so the rebase has real work to do.
		await deps.commit(deps.root, "trunk.txt", "trunk\n", "add trunk");

		await deps.finish(worktree);
		const facts: Partial<Facts["merge"]> = {};
		await merge(deps, worktree, facts);
		expect(facts.durationMs).toBeGreaterThan(0);
		expect(facts.gateMs).toBeGreaterThan(0);
		expect(facts.capacityWaitMs).toBeGreaterThan(0);
		expect(facts.retests).toBe(0);
		expect(Object.keys(facts.stepsMs ?? {})).toEqual([
			"rebase",
			"test",
			"land",
			"finish",
		]);

		expect(await deps.gitCli(deps.root, "log", "--oneline", "main")).toContain(
			"add alpha",
		);
		expect(
			await deps.gitCli(deps.root, "rev-list", "--count", "--merges", "main"),
		).toBe("0");
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("puts a branch a cut-off merge left on a batch's stack back on its own head before landing it", async () => {
		await using deps = await Testing.open();
		await add(deps, "alpha");
		await add(deps, "beta");
		const alpha = (await deps.service.find("alpha")).path;
		const beta = (await deps.service.find("beta")).path;
		await deps.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(beta, "beta.txt", "beta\n", "add beta");
		const own = await deps.git.head(beta);
		// Stacked on alpha's branch, as a batch's leader left it.
		await deps.gitCli(beta, "rebase", "task/alpha");
		const head = await deps.git.head(beta);
		await (await deps.service.find("beta")).save({ mergeStack: { own, head } });

		await deps.finish(beta);
		await merge(deps, beta);

		expect(
			await deps.gitCli(deps.root, "log", "--format=%s", "-2", "main"),
		).not.toContain("add alpha");
	});

	it("lands on a clean rebase alone when no hook is configured", async () => {
		await using deps = await Testing.open();

		deps.config.postRewrite = null;
		deps.config.preMerge = null;
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await deps.finish(worktree);
		await merge(deps, worktree);

		expect(await deps.gitCli(deps.root, "log", "--oneline", "main")).toContain(
			"add alpha",
		);
	});

	it("squashes the task's commits into one with --message", async () => {
		await using deps = await Testing.open();

		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(worktree, "beta.txt", "beta\n", "add beta");

		await deps.finish(worktree);
		await merge(deps, worktree, {}, { message: "Add alpha and beta" });

		expect(
			await deps.gitCli(
				deps.root,
				"log",
				"--format=%s",
				`${trunkBefore}..main`,
			),
		).toBe("Add alpha and beta");
		expect(
			await deps.gitCli(deps.root, "show", "--name-only", "--format=", "main"),
		).toBe("alpha.txt\nbeta.txt");
	});

	it("refuses a --message too short to say anything, spending no attempt", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);

		const facts: Partial<Facts["merge"]> = {};
		await expect(merge(deps, worktree, facts, { message: "  X  " })).toBail(
			"usage",
			{ message: "too short" },
		);
		expect(facts).toMatchObject({
			durationMs: expect.any(Number),
			gateMs: 0,
			capacityWaitMs: 0,
			retests: 0,
		});
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);

		await merge(deps, worktree, {}, { message: "Add alpha" });
		expect(
			await deps.gitCli(deps.root, "log", "-1", "--format=%s", "main"),
		).toBe("Add alpha");
	});

	it("keeps each commit without --message", async () => {
		await using deps = await Testing.open();

		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(worktree, "beta.txt", "beta\n", "add beta");

		await deps.finish(worktree);
		await merge(deps, worktree);

		expect(
			await deps.gitCli(
				deps.root,
				"rev-list",
				"--count",
				`${trunkBefore}..main`,
			),
		).toBe("2");
	});

	it("lands a --base task on its base branch and leaves trunk alone", async () => {
		await using deps = await Testing.open();

		await deps.gitCli(deps.root, "branch", "feature", "main");
		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");
		await add(deps, "alpha", { base: "feature" });
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await deps.finish(worktree);
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

		await deps.finish(child);
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

		// Names the parent's agent as the one to act, so the child's agent does
		// not go committing or stashing in a tree it does not own.
		await deps.finish(child);
		await expect(merge(deps, child)).toBail("merge_failed", {
			message: [parent, "The agent working on 'parent' has to commit"],
		});
		expect((await deps.service.find("child")).state?.mergeAttempts).toBe(1);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("discards the landed task, so it drops out of the listing", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await deps.finish(worktree);
		await merge(deps, worktree);

		expect((await deps.service.find("alpha")).status).toBe("removed");
		expect(await deps.fs.exists(worktree)).toBe(false);
		// The shell that ran it is left there, which merge cannot change.
		expect(deps.out()).toContain(
			`your shell is still in the removed ${worktree}: \`cd ${deps.root}\``,
		);
		expect(await deps.service.list()).toEqual([]);
	});

	it("keeps the landed task, its commit and plan, among the finished", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha", { goal: "land alpha" });
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await deps.finish(worktree);
		await merge(deps, worktree);

		const [finished] = await deps.service.finished.list();
		const head = await deps.gitCli(deps.root, "rev-parse", "--short", "main");
		expect(finished).toMatchObject({
			task: "alpha",
			subject: "land alpha",
			ended: "merged",
			base: "main",
			commit: head.trim(),
		});
		const read = await deps.service.finished.read(finished?.key ?? "");
		expect(read?.plan).toContain("## Goal\n\nland alpha");
	});
});
