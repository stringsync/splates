import { expect, test } from "bun:test";
import { bails, fixture, LIVE_PID } from "../lib/fixture";
import { create } from "./create";
import { prune } from "./prune";

test("prune removes everything and says what was thrown away", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	const worktree = (await f.arbor.store.find("alpha")).path;
	await f.commit(worktree, "alpha.txt", "alpha\n", "unlanded work");

	await prune(f.arbor, "alpha");

	expect(f.out()).toContain("discarded 1 commit(s)");
	expect(await f.fs.exists(worktree)).toBe(false);
	expect(await f.fs.exists(f.arbor.store.recordPath("alpha"))).toBe(false);
	expect(await f.git(f.root, "branch", "--list", "task/alpha")).toBe("");
	await f.cleanup();
});

test("prune tells 'already pruned' apart from 'never existed'", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	await prune(f.arbor, "alpha");

	expect((await bails(prune(f.arbor, "alpha"))).reason).toBe("already_pruned");
	expect((await bails(prune(f.arbor, "never"))).reason).toBe("not_found");
	await f.cleanup();
});

test("prune cleans up leftovers when the worktree directory is already gone", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	const worktree = (await f.arbor.store.find("alpha")).path;
	await f.fs.rm(worktree, { recursive: true, force: true });

	await prune(f.arbor, "alpha");

	expect(f.out()).toContain("already gone");
	expect(await f.git(f.root, "branch", "--list", "task/alpha")).toBe("");
	await f.cleanup();
});

test("prune refuses a tree another agent is driving, unless forced", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	const worktree = await (await f.arbor.store.find("alpha")).save({
		lease: {
			pid: LIVE_PID,
			hostname: f.ps.hostname,
			heartbeatAt: new Date().toISOString(),
		},
	});

	expect((await bails(prune(f.arbor, "alpha"))).reason).toBe("lease_live");

	await prune(f.arbor, "alpha", { force: true });
	expect(await f.fs.exists(worktree.path)).toBe(false);
	await f.cleanup();
});
