import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Testing } from "../testing";
import { Watch } from "./watch";

describe("Watch, told of branches moved", () => {
	let env: Testing;
	let tree: string;
	/** Each branch the watch said a command moved. */
	let moved: string[];
	let watch: Watch;

	beforeEach(async () => {
		env = await Testing.open();
		tree = join(env.config.worktreeRoot, "login");
		await env.gitCli(env.root, "worktree", "add", "-b", "task/login", tree);
		moved = [];
		watch = new Watch(env.git, { moved: (branch) => moved.push(branch) });
	});

	afterEach(() => env.disposeAsync());

	const run = async (steps: () => Promise<unknown>) => {
		const watched = watch.command(tree);
		await watched.looked();
		await steps();
		await watched.done(null);
	};

	it("tells of each command that moves the branch, and only those", async () => {
		await run(() => env.commit(tree, "a.txt", "one\n", "a"));
		await run(() => env.gitCli(tree, "status"));
		await run(() => env.gitCli(tree, "commit", "--amend", "-m", "a again"));

		expect(moved).toEqual(["task/login", "task/login"]);
	});
});
