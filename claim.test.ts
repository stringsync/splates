import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { claim } from "./claim";
import type { Config } from "./config";
import { Git } from "./git";
import { Shell } from "./shell";
import { bails, LIVE_PID, repo, testConfig } from "./testing";
import { WorktreeService } from "./worktree-service";

describe("claim", () => {
	// `shell` and `config` are here for the `create` calls that arrange each
	// test; claim itself needs only the service, the log and somewhere to fail.
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		service: WorktreeService;
		shell: Shell;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const service = new WorktreeService(
			new Git(fixture.root, { ps: fixture.ps, fs: fixture.fs }),
			config,
			fixture.arborDir,
			{ fs: fixture.fs, ps: fixture.ps },
		);
		await service.init();
		deps = {
			...fixture,
			config,
			service,
			shell: new Shell({ ps: fixture.ps }),
		};
	});

	afterEach(() => deps.cleanup());

	it("refuses a live lease and takes a cold one", async () => {
		await add(deps, "alpha");
		await (await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		const exit = await bails(claim(deps, "alpha"));
		expect(exit.reason).toBe("lease_held");

		// The same lease, gone cold because the heartbeat aged out.
		await (await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
			},
		});
		await claim(deps, "alpha");

		expect((await deps.service.find("alpha")).state?.lease?.pid).toBe(
			deps.ps.pid,
		);
		expect(deps.out()).toContain("claimed alpha");
	});

	it("rebuilds a missing record and reports an interrupted rebase", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;

		await deps.commit(deps.root, "README.md", "trunk side\n", "trunk");
		await deps.commit(worktree, "README.md", "task side\n", "task");
		await deps.ps.spawnCapture(["git", "-C", worktree, "rebase", "main"]);
		await deps.fs.rm(deps.service.recordPath("alpha"));

		await claim(deps, "alpha");

		expect(deps.out()).toContain("state file rebuilt from disk");
		expect(deps.out()).toContain("rebase in progress");
		expect((await deps.service.find("alpha")).state).toMatchObject({
			branch: "task/alpha",
		});
	});

	it("reports a record whose worktree is gone as orphaned", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.rm(worktree, { recursive: true, force: true });

		const exit = await bails(claim(deps, "alpha"));

		expect(exit.reason).toBe("orphaned");
		expect(exit.message).toContain("arbor rm alpha");
	});
});
