import { describe, expect, test } from "bun:test";
import { Failures } from "../lib/failures";
import { Git } from "../lib/git";
import { Shell } from "../lib/shell";
import { repo, testConfig } from "../lib/testing";
import { WorktreeStore } from "../lib/worktree-store";
import { create } from "./create";
import { ls } from "./ls";

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
	// ls needs only the store and the log; the rest arranges it with `create`.
	return {
		...r,
		config,
		store,
		shell: new Shell(r.ps),
		failures: new Failures(),
	};
}

describe("ls", () => {
	test("lists tasks, survives a corrupt record, and flags orphans", async () => {
		const d = await setup();
		await create(d, d.failures, "alpha");
		await create(d, d.failures, "beta");
		await d.fs.write(d.store.recordPath("broken"), "{not json");
		const beta = (await d.store.find("beta")).path;
		await d.fs.rm(beta, { recursive: true, force: true });

		await ls(d);

		expect(d.out()).toContain("alpha");
		expect(d.out()).toContain("unknown"); // the corrupt row, not a crash
		expect(d.out()).toContain("orphaned");

		d.log.clear();
		await ls(d, { json: true });
		const rows = JSON.parse(d.out());
		expect(rows.map((r: { task: string }) => r.task)).toEqual([
			"alpha",
			"beta",
			"broken",
		]);
		await d.cleanup();
	});

	test("says so plainly when there is nothing to list", async () => {
		const d = await setup();

		await ls(d);

		expect(d.out()).toContain("no workstreams");
		await d.cleanup();
	});
});
