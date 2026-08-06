import { describe, expect, test } from "bun:test";
import { Failures } from "../lib/failures";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { bails, LIVE_PID, raised, repo, testConfig } from "../lib/testing";
import { WorktreeStore } from "../lib/worktree-store";
import { claim } from "./claim";
import { create } from "./create";

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
	const failures = new Failures();
	// `shell` and `config` are here for the `create` calls that arrange each
	// test; claim itself needs only the store, the log and somewhere to fail.
	return {
		...r,
		config,
		store,
		shell: new Shell(r.ps),
		failures,
		raised: raised(failures),
	};
}

describe("claim", () => {
	test("refuses a live lease and takes a cold one", async () => {
		const d = await setup();
		await create(d, d.failures, "alpha");
		// A live lease held by another, running process.
		await (await d.store.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: d.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		const exit = await bails(claim(d, d.failures, "alpha"));
		expect(exit.reason).toBe("lease_live");
		expect(exit.code).toBe(6);

		// The same lease, gone cold because the heartbeat aged out.
		await (await d.store.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: d.ps.hostname,
				heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
			},
		});
		await claim(d, d.failures, "alpha");

		expect((await d.store.find("alpha")).state?.lease?.pid).toBe(d.ps.pid);
		expect(d.out()).toContain("claimed alpha");
		await d.cleanup();
	});

	test("rebuilds a missing record and reports an interrupted rebase", async () => {
		const d = await setup();
		await create(d, d.failures, "alpha");
		const worktree = (await d.store.find("alpha")).path;

		// Stand the worktree in a half-finished rebase, then lose the record.
		await d.commit(d.root, "README.md", "trunk side\n", "trunk");
		await d.commit(worktree, "README.md", "task side\n", "task");
		await d.ps.spawnCapture(["git", "-C", worktree, "rebase", "main"]);
		await d.fs.rm(d.store.recordPath("alpha"));

		await claim(d, d.failures, "alpha");

		expect(d.out()).toContain("state file rebuilt from disk");
		expect(d.out()).toContain("rebase in progress");
		expect((await d.store.find("alpha")).state).toMatchObject({
			branch: "task/alpha",
		});
		await d.cleanup();
	});

	test("reports a record whose worktree is gone as orphaned", async () => {
		const d = await setup();
		await create(d, d.failures, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.fs.rm(worktree, { recursive: true, force: true });

		const exit = await bails(claim(d, d.failures, "alpha"));

		expect(exit.reason).toBe("orphaned");
		expect(d.raised.at(-1)?.message).toContain("arbor prune alpha");
		await d.cleanup();
	});
});
