import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { claim } from "./claim";
import type { Config } from "./config";
import { Git } from "./git";
import { Shell } from "./shell";
import { bails, LIVE_PID, repo, testConfig } from "./testing";
import { WorktreeStore } from "./worktree-store";

describe("claim", () => {
	// `shell` and `config` are here for the `create` calls that arrange each
	// test; claim itself needs only the store, the log and somewhere to fail.
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		store: WorktreeStore;
		shell: Shell;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const store = new WorktreeStore(
			fixture.fs,
			fixture.ps,
			new Git(fixture.ps, fixture.fs, fixture.root),
			config,
			fixture.arborDir,
		);
		await store.init();
		deps = { ...fixture, config, store, shell: new Shell(fixture.ps) };
	});

	afterEach(() => deps.cleanup());

	it("refuses a live lease and takes a cold one", async () => {
		await add(deps, "alpha");
		await (await deps.store.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		const exit = await bails(claim(deps, "alpha"));
		expect(exit.reason).toBe("lease_held");

		// The same lease, gone cold because the heartbeat aged out.
		await (await deps.store.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
			},
		});
		await claim(deps, "alpha");

		expect((await deps.store.find("alpha")).state?.lease?.pid).toBe(
			deps.ps.pid,
		);
		expect(deps.out()).toContain("claimed alpha");
	});

	it("rebuilds a missing record and reports an interrupted rebase", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.store.find("alpha")).path;

		await deps.commit(deps.root, "README.md", "trunk side\n", "trunk");
		await deps.commit(worktree, "README.md", "task side\n", "task");
		await deps.ps.spawnCapture(["git", "-C", worktree, "rebase", "main"]);
		await deps.fs.rm(deps.store.recordPath("alpha"));

		await claim(deps, "alpha");

		expect(deps.out()).toContain("state file rebuilt from disk");
		expect(deps.out()).toContain("rebase in progress");
		expect((await deps.store.find("alpha")).state).toMatchObject({
			branch: "task/alpha",
		});
	});

	it("reports a record whose worktree is gone as orphaned", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.store.find("alpha")).path;
		await deps.fs.rm(worktree, { recursive: true, force: true });

		const exit = await bails(claim(deps, "alpha"));

		expect(exit.reason).toBe("orphaned");
		expect(exit.message).toContain("arbor rm alpha");
	});
});
