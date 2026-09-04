import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { rm } from "./rm";
import { LIVE_PID, Testing } from "./testing";

describe("rm", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("removes everything and says what was thrown away", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "unlanded work");

		await rm(deps, "alpha");

		expect(deps.out()).toContain("discarded 1 commit(s)");
		expect(await deps.fs.exists(worktree)).toBe(false);
		expect(await deps.fs.exists(deps.service.recordPath("alpha"))).toBe(false);
		expect(await deps.gitCli(deps.root, "branch", "--list", "task/alpha")).toBe(
			"",
		);
	});

	it("tells 'already removed' apart from 'never existed'", async () => {
		await add(deps, "alpha");
		await rm(deps, "alpha");

		await expect(rm(deps, "alpha")).toBail("already_removed");
		await expect(rm(deps, "never")).toBail("not_found");
	});

	it("cleans up leftovers when the worktree directory is already gone", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.rm(worktree, { recursive: true, force: true });

		await rm(deps, "alpha");

		expect(deps.out()).toContain("already gone");
		expect(await deps.gitCli(deps.root, "branch", "--list", "task/alpha")).toBe(
			"",
		);
	});

	it("refuses a tree another agent is driving, unless forced", async () => {
		await add(deps, "alpha");
		const worktree = await (await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		await expect(rm(deps, "alpha")).toBail("lease_held", {
			message: "--force",
		});

		await rm(deps, "alpha", { force: true });
		expect(await deps.fs.exists(worktree.path)).toBe(false);
	});
});
