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
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		store: WorktreeStore;
		shell: Shell;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const store = new WorktreeStore(
			fixture.fs,
			fixture.ps,
			new Git(fixture.ps, fixture.fs, fixture.root),
			config,
			fixture.arborDir,
		);
		await store.init();
		deps = { ...fixture, config, store, shell: new Shell(fixture.ps) };
	});

	afterEach(() => deps.cleanup());

	it("prints the main tree bare, so `cd $(arbor path)` works", async () => {
		await path(deps);

		// Bare: no label, no decoration, nothing a shell would have to strip.
		expect(deps.out()).toBe(deps.root);
	});

	it("prints a task's worktree, and refuses one that is not there", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.store.find("alpha")).path;
		deps.log.clear();

		await path(deps, "alpha");
		expect(deps.out()).toBe(worktree);

		expect((await bails(path(deps, "nope"))).reason).toBe("not_found");

		await deps.fs.rm(worktree, { recursive: true, force: true });
		expect((await bails(path(deps, "alpha"))).reason).toBe("orphaned");
	});
});
