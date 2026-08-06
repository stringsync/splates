import { expect, test } from "bun:test";
import { join } from "node:path";
import { bails, fixture } from "../lib/fixture";
import { create } from "./create";

test("create makes a worktree, a branch, a port and a record", async () => {
	const f = await fixture();

	await create(f.arbor, "alpha");

	const state = (await f.arbor.store.find("alpha")).state;
	expect(state).toMatchObject({
		task: "alpha",
		branch: "task/alpha",
		status: "working",
		graftAttempts: 0,
	});
	expect(state?.port).toBeGreaterThanOrEqual(3100);
	expect(await f.fs.exists(join(state?.worktree ?? "", "README.md"))).toBe(
		true,
	);
	expect(
		await f.git(state?.worktree ?? "", "rev-parse", "--abbrev-ref", "HEAD"),
	).toBe("task/alpha");
	expect(f.out()).toContain("created alpha");
	await f.cleanup();
});

test("create refuses a name that is already taken and points at claim", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");

	const exit = await bails(create(f.arbor, "alpha"));

	expect(exit.reason).toBe("exists");
	expect(exit.code).toBe(10);
	expect(f.out()).toContain("arbor claim alpha");
	await f.cleanup();
});

test("create rejects task names that are not legal branch or directory names", async () => {
	const f = await fixture();

	for (const name of ["Alpha", "a b", "feature/x", "-alpha", ""]) {
		expect((await bails(create(f.arbor, name))).reason).toBe("usage");
	}
	await f.cleanup();
});

test("a failed postCreate hook is reported but keeps the worktree", async () => {
	const f = await fixture({ postCreate: "exit 3" });

	const exit = await bails(create(f.arbor, "alpha"));

	expect(exit.reason).toBe("hook_failed");
	expect(exit.code).toBe(9);
	const state = (await f.arbor.store.find("alpha")).state;
	expect(await f.fs.exists(state?.worktree ?? "")).toBe(true);
	await f.cleanup();
});
