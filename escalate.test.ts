import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import { escalate } from "./escalate";
import { Testing } from "./testing";

describe("escalate", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("records the reason, drops the lease, and leaves the tree alone", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.write(join(worktree, "half-done.txt"), "work in progress\n");

		await escalate(deps, "both sides restructured the router", worktree);

		const state = (await deps.service.find("alpha")).state;
		expect(state).toMatchObject({ status: "escalated", lease: null });
		expect(state?.escalations).toHaveLength(1);
		expect(await deps.fs.exists(join(worktree, "half-done.txt"))).toBe(true);

		await escalate(deps, "second thoughts", worktree);
		expect((await deps.service.find("alpha")).state?.escalations).toHaveLength(
			2,
		);
	});

	it("requires an explicit task when run outside a worktree", async () => {
		await add(deps, "alpha");

		await expect(escalate(deps, "needs a human", deps.root)).toBail("usage", {
			message: "--task",
		});

		await escalate(deps, "needs a human", deps.root, { task: "alpha" });
		expect((await deps.service.find("alpha")).state?.status).toBe("escalated");
	});
});
