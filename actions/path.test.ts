import { describe, expect, test } from "bun:test";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { bails, repo, testConfig } from "../lib/testing";
import { WorktreeStore } from "../lib/worktree-store";
import { create } from "./create";
import { path } from "./path";

/** Called per test rather than once per describe: these run concurrently. */
async function setup() {
	const r = await repo();
	const config = testConfig(r.root);
	const store = new WorktreeStore(
		r.fs,
		r.ps,
		new Git(r.ps, r.fs, r.root),
		config,
		r.arborDir,
	);
	await store.init();
	// `shell` and `config` are here for the `create` calls that arrange each
	// test; path itself needs only the store and the log.
	return { ...r, config, store, shell: new Shell(r.ps) };
}

describe("path", () => {
	test("prints the main tree bare, so `cd $(arbor path)` works", async () => {
		const d = await setup();

		await path(d);

		// Bare: no label, no decoration, nothing a shell would have to strip.
		expect(d.out()).toBe(d.root);
		await d.cleanup();
	});

	test("prints a task's worktree, and refuses one that is not there", async () => {
		const d = await setup();
		await create(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		d.log.clear();

		await path(d, "alpha");
		expect(d.out()).toBe(worktree);

		expect((await bails(path(d, "nope"))).reason).toBe("not_found");

		await d.fs.rm(worktree, { recursive: true, force: true });
		expect((await bails(path(d, "alpha"))).reason).toBe("orphaned");
		await d.cleanup();
	});
});
