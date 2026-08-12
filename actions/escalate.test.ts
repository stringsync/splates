import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FileLock } from "@webappwiz/sys";
import type { Config } from "../config";
import { Git } from "../git";
import { Shell } from "../shell";
import { bails, repo, testConfig } from "../testing";
import { WorktreeStore } from "../worktree-store";
import { create } from "./create";
import { escalate } from "./escalate";

describe("escalate", () => {
	let d: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		git: Git;
		store: WorktreeStore;
		shell: Shell;
		lock: FileLock;
	};

	beforeEach(async () => {
		const r = await repo();
		const config = testConfig(r.root);
		const git = new Git(r.ps, r.fs, r.root);
		const store = new WorktreeStore(r.fs, r.ps, git, config, r.arborDir);
		await store.init();
		d = {
			...r,
			config,
			git,
			store,
			shell: new Shell(r.ps),
			lock: new FileLock(r.fs, r.ps, r.log, join(r.arborDir, "graft.lock"), {
				stalenessMs: config.leaseStalenessMs,
			}),
		};
	});

	afterEach(() => d.cleanup());

	it("records the reason, drops the lease, and leaves the tree alone", async () => {
		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.fs.write(join(worktree, "half-done.txt"), "work in progress\n");

		await escalate(d, "both sides restructured the router", worktree);

		const state = (await d.store.find("alpha")).state;
		expect(state).toMatchObject({ status: "escalated", lease: null });
		expect(state?.escalations).toHaveLength(1);
		expect(await d.fs.exists(join(worktree, "half-done.txt"))).toBe(true);

		await escalate(d, "second thoughts", worktree);
		expect((await d.store.find("alpha")).state?.escalations).toHaveLength(2);
	});

	it("requires an explicit task when run outside a worktree", async () => {
		await create(d, "alpha");

		const exit = await bails(escalate(d, "needs a human", d.root));

		expect(exit.reason).toBe("usage");
		expect(exit.message).toContain("--task");

		await escalate(d, "needs a human", d.root, "alpha");
		expect((await d.store.find("alpha")).state?.status).toBe("escalated");
	});
});
