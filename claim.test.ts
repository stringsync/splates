import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { claim } from "./claim";
import { LIVE_PID, Testing } from "./testing";

describe("claim", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("refuses a live lease and takes a cold one", async () => {
		await add(deps, "alpha");
		await (await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		await expect(claim(deps, "alpha")).toBail("lease_held");

		// An old heartbeat does not cool a live pid on this host: a merge whose
		// test gate outlasts the staleness window is still running.
		await (await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
			},
		});
		await expect(claim(deps, "alpha")).toBail("lease_held");

		// A holder on another host goes cold when its heartbeat ages out.
		await (await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: "elsewhere",
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

		await expect(claim(deps, "alpha")).toBail("orphaned", {
			message: "arbor remove alpha",
		});
	});

	it("puts an escalated task back to working, keeping its budget", async () => {
		await add(deps, "alpha");
		await (await deps.service.find("alpha")).save({
			status: "escalated",
			lease: null,
			mergeAttempts: 1,
			escalations: [{ reason: "needs a look", at: new Date().toISOString() }],
		});

		await claim(deps, "alpha");

		expect((await deps.service.find("alpha")).state).toMatchObject({
			status: "working",
			mergeAttempts: 1,
			escalations: [{ reason: "needs a look" }],
		});
		expect(deps.out()).toContain("status:   working (was escalated)");
	});
});
