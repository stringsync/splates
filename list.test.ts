import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { color } from "webappwiz/log";
import { add } from "./add";
import { list } from "./list";
import { Testing } from "./testing";

describe("list", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("lists tasks, survives a corrupt record, and flags orphans", async () => {
		await add(deps, "alpha");
		await add(deps, "beta");
		await deps.fs.write(deps.service.recordPath("broken"), "{not json");
		const beta = (await deps.service.find("beta")).path;
		await deps.fs.rm(beta, { recursive: true, force: true });

		await list(deps);

		expect(deps.out()).toContain("alpha");
		expect(deps.out()).toContain("unknown"); // the corrupt row, not a crash
		expect(deps.out()).toContain("orphaned");
		expect(color.strip(deps.out())).toContain("+0 -0");

		deps.log.clear();
		await list(deps, { json: true });
		const rows = JSON.parse(deps.out());
		expect(rows.map((fixture: { task: string }) => fixture.task)).toEqual([
			"alpha",
			"beta",
			"broken",
		]);
	});

	it("names each task's changed and planned files with --files", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "committed.txt", "a\n", "add committed");
		await deps.fs.write(`${worktree}/untracked.txt`, "b\n");
		await deps.fs.write(
			`${worktree}/ARBOR.md`,
			"# alpha\n\n## Files\n\n- `committed.txt`\n- planned.txt\n\nprose, not a path\n",
		);

		deps.log.clear();
		await list(deps, { files: true });

		const out = color.strip(deps.out());
		expect(out).toContain("changed  committed.txt");
		expect(out).toContain("changed  untracked.txt");
		expect(out).toContain("planned  planned.txt");
		expect(out).not.toContain("planned  committed.txt");
		expect(out).not.toContain("ARBOR.md"); // excluded, so never a change

		deps.log.clear();
		await list(deps, { json: true, files: true });
		const [row] = JSON.parse(deps.out());
		expect(row.changed).toEqual(["committed.txt", "untracked.txt"]);
		expect(row.planned).toEqual(["committed.txt", "planned.txt"]);
	});

	it("leaves files out unless asked", async () => {
		await add(deps, "alpha");
		deps.log.clear();

		await list(deps, { json: true });

		const [row] = JSON.parse(deps.out());
		expect(row).not.toHaveProperty("changed");
	});

	it("says so plainly when there is nothing to list", async () => {
		await list(deps);

		expect(deps.out()).toContain("no tasks");
	});
});
