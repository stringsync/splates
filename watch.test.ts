import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Testing } from "./testing";
import { Watch } from "./watch";

describe("Watch", () => {
	let env: Testing;
	let tree: string;
	let watch: Watch;

	beforeEach(async () => {
		env = await Testing.open();
		tree = join(env.config.worktreeRoot, "login");
		await env.gitCli(env.root, "worktree", "add", "-b", "task/login", tree);
		await env.commit(tree, "a.txt", "one\n", "a");
		watch = new Watch(env.git);
	});

	afterEach(() => env.disposeAsync());

	/** What running `steps` in the task's tree did, as the watch tells it. */
	const after = async (steps: () => Promise<unknown>, cwd = tree) => {
		const watched = watch.command(cwd);
		await watched.looked();
		await steps();
		return watched.done();
	};

	const git = (...args: string[]) => env.gitCli(tree, ...args);

	it("says nothing of a command that commits", async () => {
		expect(await after(() => env.commit(tree, "b.txt", "two\n", "b"))).toEqual(
			[],
		);
	});

	it("flags a stash left behind, but not one popped again", async () => {
		await env.fs.write(join(tree, "a.txt"), "changed\n");

		expect(await after(() => git("stash"))).toEqual([
			{ type: "stashed", count: 1 },
		]);
		expect(
			await after(async () => {
				await git("stash", "pop");
				await git("stash");
				await git("stash", "pop");
			}),
		).toEqual([]);
	});

	it("flags commits reset off the branch", async () => {
		expect(await after(() => git("reset", "--hard", "HEAD~1"))).toEqual([
			{ type: "dropped", branch: "task/login" },
		]);
	});

	it("says nothing of a squash, even one split over two commands", async () => {
		await env.commit(tree, "b.txt", "two\n", "b");

		expect(
			await after(async () => {
				await git("reset", "--soft", "main");
				await git("commit", "-m", "squashed");
			}),
		).toEqual([]);
		expect(await after(() => git("reset", "--soft", "main"))).toEqual([]);
	});

	it("says nothing of a rebase onto trunk that moved on", async () => {
		await env.commit(env.root, "c.txt", "trunk\n", "c");

		expect(await after(() => git("rebase", "main"))).toEqual([]);
	});

	it("flags a checkout off the branch", async () => {
		expect(await after(() => git("checkout", "--detach"))).toEqual([
			{ type: "left", branch: "task/login", now: null },
		]);
	});

	it("says nothing of HEAD detached by a rebase that stopped on a conflict", async () => {
		await env.commit(env.root, "a.txt", "trunk\n", "a on trunk");

		expect(
			await after(() => git("rebase", "main").catch(() => undefined)),
		).toEqual([]);
	});

	it("flags a push", async () => {
		const remote = join(env.config.worktreeRoot, "..", "remote.git");
		await env.gitCli(env.root, "init", "--bare", remote);
		await env.gitCli(env.root, "remote", "add", "origin", remote);
		await env.gitCli(env.root, "push", "origin", "main");
		await env.gitCli(env.root, "fetch", "origin");

		expect(await after(() => git("push", "origin", "task/login"))).toEqual([
			{ type: "pushed", refs: ["origin/task/login"] },
		]);
		expect(await after(() => git("fetch", "origin"))).toEqual([]);
	});

	it("flags files changed in the main tree, but not by a command run there", async () => {
		await env.fs.write(join(env.root, "README.md"), "edited\n");
		await env.fs.write(join(env.root, "my notes.txt"), "mine\n");

		expect(
			await after(async () => {
				await env.fs.write(join(env.root, "README.md"), "edited again\n");
				await env.fs.write(join(env.root, "stray.txt"), "oops\n");
			}),
		).toEqual([{ type: "outside", paths: ["stray.txt"] }]);
		expect(
			await after(
				() => env.fs.write(join(env.root, "other.txt"), "here\n"),
				env.root,
			),
		).toEqual([]);
	});

	it("says nothing of a tree removed under it, as a merge removes one", async () => {
		expect(
			await after(async () => {
				await env.gitCli(env.root, "worktree", "remove", "--force", tree);
				await env.gitCli(env.root, "branch", "-D", "task/login");
			}),
		).toEqual([]);
	});
});
