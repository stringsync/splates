import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Config } from "../lib/config";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { bails, LIVE_PID, repo, testConfig } from "../lib/testing";
import { WorktreeStore } from "../lib/worktree-store";
import { claim } from "./claim";
import { create } from "./create";

describe("claim", () => {
	// `shell` and `config` are here for the `create` calls that arrange each
	// test; claim itself needs only the store, the log and somewhere to fail.
	let d: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		store: WorktreeStore;
		shell: Shell;
	};

	beforeEach(async () => {
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
		d = { ...r, config, store, shell: new Shell(r.ps) };
	});

	afterEach(() => d.cleanup());

	it("refuses a live lease and takes a cold one", async () => {
		await create(d, "alpha");
		await (await d.store.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: d.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		const exit = await bails(claim(d, "alpha"));
		expect(exit.reason).toBe("lease_live");

		// The same lease, gone cold because the heartbeat aged out.
		await (await d.store.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: d.ps.hostname,
				heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
			},
		});
		await claim(d, "alpha");

		expect((await d.store.find("alpha")).state?.lease?.pid).toBe(d.ps.pid);
		expect(d.out()).toContain("claimed alpha");
	});

	it("rebuilds a missing record and reports an interrupted rebase", async () => {
		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;

		await d.commit(d.root, "README.md", "trunk side\n", "trunk");
		await d.commit(worktree, "README.md", "task side\n", "task");
		await d.ps.spawnCapture(["git", "-C", worktree, "rebase", "main"]);
		await d.fs.rm(d.store.recordPath("alpha"));

		await claim(d, "alpha");

		expect(d.out()).toContain("state file rebuilt from disk");
		expect(d.out()).toContain("rebase in progress");
		expect((await d.store.find("alpha")).state).toMatchObject({
			branch: "task/alpha",
		});
	});

	it("reports a record whose worktree is gone as orphaned", async () => {
		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.fs.rm(worktree, { recursive: true, force: true });

		const exit = await bails(claim(d, "alpha"));

		expect(exit.reason).toBe("orphaned");
		expect(exit.message).toContain("arbor prune alpha");
	});
});
