import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import { escalate, REVIEW_SUBJECT } from "./escalate";
import { PLAN_FILE, questions } from "./plan";
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

	it("asks for approval with a question of its own, once nothing else is open", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		const plan = join(worktree, PLAN_FILE);
		await deps.fs.write(plan, "# alpha\n\n## Blocked\n\n- [ ] 1. Keep it?\n");

		await expect(
			escalate(deps, "check the header", worktree, { review: true }),
		).toBail("blocked", { data: { task: "alpha", blocked: ["1"] } });

		await deps.fs.write(
			plan,
			"# alpha\n\n## Blocked\n\n- [x] 1. Keep it? → yes\n",
		);
		await escalate(deps, "check the header at 390px", worktree, {
			review: true,
		});

		expect(questions(await deps.fs.read(plan)).at(-1)).toMatchObject({
			number: "2",
			text: REVIEW_SUBJECT,
			body: "check the header at 390px",
		});
		expect(
			(await deps.service.find("alpha")).state?.escalations?.at(-1),
		).toMatchObject({ reason: "check the header at 390px", review: "2" });
		expect(deps.out()).toContain(
			"review:   question 2 asks to approve merging",
		);
	});
});
