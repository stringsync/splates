import { expect, test } from "bun:test";
import { join } from "node:path";
import { bails, fixture } from "../lib/fixture";
import { create } from "./create";
import { escalate } from "./escalate";

test("escalate records the reason, drops the lease, and leaves the tree alone", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	const worktree = (await f.arbor.store.find("alpha")).path;
	await f.fs.write(join(worktree, "half-done.txt"), "work in progress\n");

	await escalate(f.arbor, "both sides restructured the router", worktree);

	const state = (await f.arbor.store.find("alpha")).state;
	expect(state).toMatchObject({ status: "escalated", lease: null });
	expect(state?.escalations).toHaveLength(1);
	expect(await f.fs.exists(join(worktree, "half-done.txt"))).toBe(true);

	await escalate(f.arbor, "second thoughts", worktree);
	expect((await f.arbor.store.find("alpha")).state?.escalations).toHaveLength(
		2,
	);
	await f.cleanup();
});

test("escalate outside a worktree needs an explicit task", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");

	expect((await bails(escalate(f.arbor, "needs a human", f.root))).reason).toBe(
		"usage",
	);

	await escalate(f.arbor, "needs a human", f.root, "alpha");
	expect((await f.arbor.store.find("alpha")).state?.status).toBe("escalated");
	await f.cleanup();
});
