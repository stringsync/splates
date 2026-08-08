import { describe, expect, test } from "bun:test";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { bails, LIVE_PID, repo, testConfig } from "../lib/testing";
import { WorktreeStore } from "../lib/worktree-store";
import { create } from "./create";
import { prune } from "./prune";

/** Called per test rather than once per describe: these run concurrently. */
async function setup() {
	const r = await repo();
	const config = testConfig(r.root);
	const store = new WorktreeStore(
		r.fs,
		r.ps,
		new Git(r.ps, r.fs, r.root),
		config,
		r.arborDir,
	);
	await store.init();
	// `shell` is only here for the `create` calls that arrange each test.
	return {
		...r,
		config,
		store,
		shell: new Shell(r.ps),
	};
}

describe("prune", () => {
	test("removes everything and says what was thrown away", async () => {
		const d = await setup();
		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.commit(worktree, "alpha.txt", "alpha\n", "unlanded work");

		await prune(d, "alpha");

		expect(d.out()).toContain("discarded 1 commit(s)");
		expect(await d.fs.exists(worktree)).toBe(false);
		expect(await d.fs.exists(d.store.recordPath("alpha"))).toBe(false);
		expect(await d.gitCli(d.root, "branch", "--list", "task/alpha")).toBe("");
		await d.cleanup();
	});

	test("tells 'already pruned' apart from 'never existed'", async () => {
		const d = await setup();
		await create(d, "alpha");
		await prune(d, "alpha");

		expect((await bails(prune(d, "alpha"))).reason).toBe("already_pruned");
		expect((await bails(prune(d, "never"))).reason).toBe("not_found");
		await d.cleanup();
	});

	test("cleans up leftovers when the worktree directory is already gone", async () => {
		const d = await setup();
		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.fs.rm(worktree, { recursive: true, force: true });

		await prune(d, "alpha");

		expect(d.out()).toContain("already gone");
		expect(await d.gitCli(d.root, "branch", "--list", "task/alpha")).toBe("");
		await d.cleanup();
	});

	test("refuses a tree another agent is driving, unless forced", async () => {
		const d = await setup();
		await create(d, "alpha");
		const worktree = await (await d.store.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: d.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		const exit = await bails(prune(d, "alpha"));

		expect(exit.reason).toBe("lease_live");
		expect(exit.message).toContain("--force");

		await prune(d, "alpha", { force: true });
		expect(await d.fs.exists(worktree.path)).toBe(false);
		await d.cleanup();
	});
});
