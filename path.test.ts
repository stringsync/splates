import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { path } from "./path";
import { Testing } from "./testing";

describe("path", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("prints the main tree bare, so `cd $(arbor path)` works", async () => {
		await path(deps);

		// Bare: no label, no decoration, nothing a shell would have to strip.
		expect(deps.out()).toBe(deps.root);
	});

	it("prints a task's worktree, and refuses one that is not there", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		deps.log.clear();

		await path(deps, "alpha");
		expect(deps.out()).toBe(worktree);

		await expect(path(deps, "nope")).toBail("not_found");

		await deps.fs.rm(worktree, { recursive: true, force: true });
		await expect(path(deps, "alpha")).toBail("orphaned");
	});
});
