import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Config } from "../config";
import { Git } from "../git";
import { Shell } from "../shell";
import { bails, repo, testConfig } from "../testing";
import { WorktreeStore } from "../worktree-store";
import { create } from "./create";
import { show } from "./show";

describe("show", () => {
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

	it("reports a task and prints the TODO.md left in its worktree", async () => {
		await create(d, "alpha");
		const alpha = (await d.store.find("alpha")).path;
		await d.fs.write(
			`${alpha}/TODO.md`,
			"# alpha\n\n## Next\n- [ ] the rest\n",
		);
		d.log.clear();

		await show(d, "alpha");

		expect(d.out()).toContain("task/alpha");
		expect(d.out()).toContain("working");
		expect(d.out()).toContain("- [ ] the rest");
	});

	it("says how a TODO.md departs from the shape the skill prescribes", async () => {
		await create(d, "alpha");
		const alpha = (await d.store.find("alpha")).path;
		await d.fs.write(
			`${alpha}/TODO.md`,
			"# something else\n\n## Goal\nland it\n",
		);
		d.log.clear();

		await show(d, "alpha");

		expect(d.out()).toContain('should be "# alpha"');
		expect(d.out()).toContain("no ## Next section");
	});

	it("says the TODO.md is missing rather than staying silent", async () => {
		await create(d, "alpha");
		d.log.clear();

		await show(d, "alpha");

		expect(d.out()).toContain("no TODO.md");
	});

	it("carries the task's fields and its TODO.md as JSON", async () => {
		await create(d, "alpha");
		const alpha = (await d.store.find("alpha")).path;
		await d.fs.write(`${alpha}/TODO.md`, "# alpha\n");
		d.log.clear();

		await show(d, "alpha", { json: true });

		expect(JSON.parse(d.out())).toMatchObject({
			task: "alpha",
			status: "working",
			branch: "task/alpha",
			ahead: 0,
			todo: "# alpha\n",
		});
	});

	it("refuses a task that was never created", async () => {
		expect((await bails(show(d, "ghost"))).reason).toBe("not_found");
	});

	it("still describes a task whose worktree is gone", async () => {
		await create(d, "alpha");
		await d.fs.rm((await d.store.find("alpha")).path, {
			recursive: true,
			force: true,
		});
		d.log.clear();

		await show(d, "alpha");

		expect(d.out()).toContain("orphaned");
		expect(d.out()).not.toContain("no TODO.md");
	});
});
