import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { Testing } from "./testing";

describe("Git", () => {
	let env: Testing;

	beforeEach(async () => {
		env = await Testing.open();
	});

	afterEach(() => env.disposeAsync());

	it("names the branch checked out", async () => {
		expect(await env.git.currentBranch(env.root)).toBe("main");
	});

	it("names no branch on a detached HEAD", async () => {
		await env.gitCli(env.root, "checkout", "--detach");

		expect(await env.git.currentBranch(env.root)).toBeNull();
	});

	it("names no branch outside any repository", async () => {
		expect(await env.git.currentBranch(dirname(env.root))).toBeNull();
	});

	it("throws when git fails for another reason, rather than naming no branch", async () => {
		await expect(env.git.currentBranch(join(env.root, "gone"))).rejects.toThrow(
			"git symbolic-ref HEAD",
		);
	});

	it("diffs a branch against where it left trunk, with its worktree's uncommitted edits", async () => {
		await env.commit(env.root, "a.txt", "one\ntwo\n", "a");
		const tree = join(dirname(env.root), "feature");
		await env.gitCli(env.root, "worktree", "add", "-b", "feature", tree);
		await env.commit(tree, "a.txt", "one\n2\n", "change a");
		// Trunk moving on is not the branch's change.
		await env.commit(env.root, "b.txt", "trunk\n", "b");
		await env.fs.write(join(tree, "a.txt"), "  one\n2\n");
		await env.fs.write(join(tree, "new.txt"), "fresh\n");

		const committed = await env.git.diff("main", "feature", null);
		const all = await env.git.diff("main", "feature", tree);

		expect(committed?.text).toContain("-two\n+2\n");
		expect(committed?.text).not.toContain("b.txt");
		expect(committed?.uncommitted).toEqual([]);
		expect(all?.text).toContain("+  one\n");
		expect(all?.text).toContain("diff --git a/new.txt b/new.txt");
		expect(all?.text).toContain("+fresh\n");
		expect(all?.uncommitted).toEqual(["a.txt", "new.txt"]);
		expect(await env.git.diff("main", "gone", null)).toBeNull();
	});
});
