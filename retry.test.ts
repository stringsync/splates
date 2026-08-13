import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import type { Config } from "./config";
import { Git } from "./git";
import { retry } from "./retry";
import { Shell } from "./shell";
import { bails, repo, testConfig } from "./testing";
import { WorktreeStore } from "./worktree-store";

describe("retry", () => {
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		git: Git;
		store: WorktreeStore;
		shell: Shell;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const git = new Git(fixture.ps, fixture.fs, fixture.root);
		const store = new WorktreeStore(
			fixture.fs,
			fixture.ps,
			git,
			config,
			fixture.arborDir,
		);
		await store.init();
		deps = { ...fixture, config, git, store, shell: new Shell(fixture.ps) };
	});

	afterEach(() => deps.cleanup());

	it("puts an escalated task back to working with a fresh budget", async () => {
		await add(deps, "alpha");
		const spent = await deps.store.find("alpha");
		await spent.save({
			status: "escalated",
			mergeAttempts: deps.config.mergeRetryCount,
		});

		await retry(deps, "alpha");

		expect((await deps.store.find("alpha")).state).toMatchObject({
			status: "working",
			mergeAttempts: 0,
		});
	});

	it("refuses a task nobody has escalated", async () => {
		await add(deps, "alpha");

		const exit = await bails(retry(deps, "alpha"));

		expect(exit.reason).toBe("usage");
		expect(exit.message).toContain("not escalated");
		expect((await deps.store.find("alpha")).state?.status).toBe("working");
	});

	it("refuses a name with no task", async () => {
		expect((await bails(retry(deps, "nope"))).reason).toBe("not_found");
	});
});
