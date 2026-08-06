import { expect, test } from "bun:test";
import { bails, fixture, LIVE_PID } from "../lib/fixture";
import { claim } from "./claim";
import { create } from "./create";

test("claim refuses a live lease and takes a cold one", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	// A live lease held by another, running process.
	await (await f.arbor.store.find("alpha")).save({
		lease: {
			pid: LIVE_PID,
			hostname: f.ps.hostname,
			heartbeatAt: new Date().toISOString(),
		},
	});
	const exit = await bails(claim(f.arbor, "alpha"));
	expect(exit.reason).toBe("lease_live");
	expect(exit.code).toBe(6);

	// The same lease, gone cold because the heartbeat aged out.
	await (await f.arbor.store.find("alpha")).save({
		lease: {
			pid: LIVE_PID,
			hostname: f.ps.hostname,
			heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
		},
	});
	await claim(f.arbor, "alpha");
	expect((await f.arbor.store.find("alpha")).state?.lease?.pid).toBe(f.ps.pid);
	expect(f.out()).toContain("claimed alpha");
	await f.cleanup();
});

test("claim rebuilds a missing record and reports an interrupted rebase", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	const worktree = (await f.arbor.store.find("alpha")).path;

	// Stand the worktree in a half-finished rebase, then lose the record.
	await f.commit(f.root, "README.md", "trunk side\n", "trunk");
	await f.commit(worktree, "README.md", "task side\n", "task");
	await f.ps.spawnCapture(["git", "-C", worktree, "rebase", "main"]);
	await f.fs.rm(f.arbor.store.recordPath("alpha"));

	await claim(f.arbor, "alpha");

	expect(f.out()).toContain("state file rebuilt from disk");
	expect(f.out()).toContain("rebase in progress");
	expect((await f.arbor.store.find("alpha")).state).toMatchObject({
		branch: "task/alpha",
	});
	await f.cleanup();
});

test("claim reports a record whose worktree is gone as orphaned", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	const worktree = (await f.arbor.store.find("alpha")).path;
	await f.fs.rm(worktree, { recursive: true, force: true });

	const exit = await bails(claim(f.arbor, "alpha"));

	expect(exit.reason).toBe("orphaned");
	expect(f.out()).toContain("arbor prune alpha");
	await f.cleanup();
});
