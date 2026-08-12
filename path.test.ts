import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import type { Config } from "./config";
import { Git } from "./git";
import { path } from "./path";
import { Shell } from "./shell";
import { bails, repo, testConfig } from "./testing";
import { WorktreeStore } from "./worktree-store";

describe("path", () => {
	// `shell` and `config` are here for the `create` calls that arrange each
	// test; path itself needs only the store and the log.
	let d: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		store: WorktreeStore;
		shell: Shell;
	};

	beforeEach(async () => {
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
		d = { ...r, config, store, shell: new Shell(r.ps) };
	});

	afterEach(() => d.cleanup());

	it("prints the main tree bare, so `cd $(arbor path)` works", async () => {
		await path(d);

		// Bare: no label, no decoration, nothing a shell would have to strip.
		expect(d.out()).toBe(d.root);
	});

	it("prints a task's worktree, and refuses one that is not there", async () => {
		await add(d, "alpha");
		const worktree = (await d.store.find("alpha")).path;
		d.log.clear();

		await path(d, "alpha");
		expect(d.out()).toBe(worktree);

		expect((await bails(path(d, "nope"))).reason).toBe("not_found");

		await d.fs.rm(worktree, { recursive: true, force: true });
		expect((await bails(path(d, "alpha"))).reason).toBe("orphaned");
	});
});
