import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FileLock } from "@webappwiz/sys";
import { Failures } from "../lib/failures";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { bails, raised, repo, testConfig } from "../lib/testing";
import { WorktreeStore } from "../lib/worktree-store";
import { create } from "./create";
import { escalate } from "./escalate";

/** Called per test rather than once per describe: these run concurrently. */
async function setup() {
	const r = await repo();
	const config = testConfig(r.root);
	const git = new Git(r.ps, r.fs, r.root);
	const store = new WorktreeStore(r.fs, r.ps, git, config, r.arborDir);
	await store.init();
	const failures = new Failures();
	return {
		...r,
		config,
		git,
		store,
		shell: new Shell(r.ps),
		lock: new FileLock(r.fs, r.ps, r.log, join(r.arborDir, "graft.lock"), {
			stalenessMs: config.leaseStalenessMs,
		}),
		failures,
		raised: raised(failures),
	};
}

describe("escalate", () => {
	test("records the reason, drops the lease, and leaves the tree alone", async () => {
		const d = await setup();
		await create(d, d.failures, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		await d.fs.write(join(worktree, "half-done.txt"), "work in progress\n");

		await escalate(
			d,
			d.failures,
			"both sides restructured the router",
			worktree,
		);

		const state = (await d.store.find("alpha")).state;
		expect(state).toMatchObject({ status: "escalated", lease: null });
		expect(state?.escalations).toHaveLength(1);
		expect(await d.fs.exists(join(worktree, "half-done.txt"))).toBe(true);

		await escalate(d, d.failures, "second thoughts", worktree);
		expect((await d.store.find("alpha")).state?.escalations).toHaveLength(2);
		await d.cleanup();
	});

	test("outside a worktree, needs an explicit task", async () => {
		const d = await setup();
		await create(d, d.failures, "alpha");

		expect(
			(await bails(escalate(d, d.failures, "needs a human", d.root))).reason,
		).toBe("usage");
		expect(d.raised.at(-1)?.message).toContain("--task");

		await escalate(d, d.failures, "needs a human", d.root, "alpha");
		expect((await d.store.find("alpha")).state?.status).toBe("escalated");
		await d.cleanup();
	});
});
