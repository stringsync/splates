import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { LIVE_PID, Testing } from "../testing";
import { add } from "./add";
import { claim } from "./claim";

describe("claim", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("says what the task's SPLATES.md gives as its Goal", async () => {
		await add(deps, "alpha", { goal: "Stop retrying on a 413." });

		expect(await claim(deps, "alpha")).toMatchObject({
			goal: "Stop retrying on a 413.",
		});
		expect(deps.out()).not.toContain("notes:");
	});

	it.each(["notes", "project-notes"])(
		"points at the task checkout's notes in %s when claiming",
		async (directory) => {
			deps.config.notesDir = directory;
			await add(deps, "alpha");
			const { path } = await deps.service.find("alpha");
			await deps.fs.mkdir(`${path}/${directory}`);
			await deps.fs.write(
				`${path}/${directory}/conventions.md`,
				"---\ndescription: Project conventions\n---\n\nUse named exports.\n",
			);

			await claim(deps, "alpha");

			expect(deps.out()).toContain("notes: 1, splates notes lists them");
			expect(deps.out()).not.toContain("Project conventions");
		},
	);

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

		// Nor does another hostname, which macOS gives this machine as the
		// network changes: the pid alone decides.
		await (await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: "Mac",
				heartbeatAt: new Date(Date.now() - 120_000).toISOString(),
			},
		});
		await expect(claim(deps, "alpha")).toBail("lease_held");

		await (await deps.service.find("alpha")).save({
			lease: {
				pid: 99_999_999,
				hostname: "Mac",
				heartbeatAt: new Date().toISOString(),
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
		await deps.storage.remove(await deps.recordOf("alpha"));

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
			message: "splates remove alpha",
		});
	});

	it("keeps a task's budget as it was", async () => {
		await add(deps, "alpha");
		await (await deps.service.find("alpha")).save({
			lease: null,
			mergeAttempts: 1,
		});

		await claim(deps, "alpha");

		expect((await deps.service.find("alpha")).state).toMatchObject({
			status: "working",
			mergeAttempts: 1,
		});
	});
});
