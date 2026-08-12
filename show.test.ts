import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import type { Config } from "./config";
import { Git } from "./git";
import { Shell } from "./shell";
import { show } from "./show";
import { bails, repo, testConfig } from "./testing";
import { WorktreeStore } from "./worktree-store";

describe("show", () => {
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

	it("reports a task and prints the ARBOR.md left in its worktree", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.store.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/ARBOR.md`,
			"# alpha\n\n## Next\n- [ ] the rest\n",
		);
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain("task/alpha");
		expect(deps.out()).toContain("working");
		expect(deps.out()).toContain("- [ ] the rest");
	});

	it("says how an ARBOR.md departs from the shape the skill prescribes", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.store.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/ARBOR.md`,
			"# something else\n\n## Goal\nland it\n",
		);
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain('should be "# alpha"');
		expect(deps.out()).toContain("no ## Next section");
	});

	it("says the ARBOR.md is missing rather than staying silent", async () => {
		await add(deps, "alpha");
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain("no ARBOR.md");
	});

	it("carries the task's fields and its ARBOR.md as JSON", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.store.find("alpha")).path;
		await deps.fs.write(`${alpha}/ARBOR.md`, "# alpha\n");
		deps.log.clear();

		await show(deps, "alpha", { json: true });

		expect(JSON.parse(deps.out())).toMatchObject({
			task: "alpha",
			status: "working",
			branch: "task/alpha",
			ahead: 0,
			plan: "# alpha\n",
		});
	});

	it("refuses a task that was never created", async () => {
		expect((await bails(show(deps, "ghost"))).reason).toBe("not_found");
	});

	it("still describes a task whose worktree is gone", async () => {
		await add(deps, "alpha");
		await deps.fs.rm((await deps.store.find("alpha")).path, {
			recursive: true,
			force: true,
		});
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain("orphaned");
		expect(deps.out()).not.toContain("no ARBOR.md");
	});
});
