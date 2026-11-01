import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { color } from "core/log";
import { Testing } from "../testing";
import { add } from "./add";
import { list } from "./list";

describe("list", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("lists tasks, survives a corrupt record, and flags orphans", async () => {
		await add(deps, "alpha");
		await add(deps, "beta");
		await deps.writeRecord("tasks/999.json", "{not json");
		const beta = (await deps.service.find("beta")).path;
		await deps.fs.rm(beta, { recursive: true, force: true });

		await list(deps);

		expect(deps.out()).toContain("alpha");
		expect(deps.out()).not.toContain("999"); // the corrupt record, not a crash
		expect(deps.out()).toContain("orphaned");
		expect(color.strip(deps.out())).toContain("+0 -0");

		deps.log.clear();
		await list(deps, { json: true });
		const rows = JSON.parse(deps.out());
		expect(rows.map((fixture: { task: string }) => fixture.task)).toEqual([
			"alpha",
			"beta",
		]);
	});

	it("names each started task by its number", async () => {
		await add(deps, "alpha");
		const { id } = (await deps.service.find("alpha")).state ?? {};

		await list(deps);
		expect(color.strip(deps.out())).toMatch(new RegExp(`#${id}\\s+alpha`));

		deps.log.clear();
		await list(deps, { json: true });
		expect(JSON.parse(deps.out())).toMatchObject([
			{ number: id, task: "alpha" },
		]);
	});

	it("shows a waiting merge's place in the merge queue beside its status", async () => {
		await add(deps, "alpha");
		const alpha = await deps.service.find("alpha");
		await alpha.save({
			lease: {
				pid: deps.ps.pid,
				hostname: "host",
				heartbeatAt: new Date().toISOString(),
			},
			mergePlace: 2,
		});

		await list(deps);
		expect(color.strip(deps.out())).toContain("(queued 2)");

		deps.log.clear();
		await list(deps, { json: true });
		expect(JSON.parse(deps.out())).toMatchObject([{ mergePlace: 2 }]);
	});

	it("names each task's Goal and changed files with --files", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "committed.txt", "a\n", "add committed");
		await deps.fs.write(`${worktree}/untracked.txt`, "b\n");
		await deps.fs.write(
			`${worktree}/SPLATES.md`,
			"# alpha\n\n## Goal\n\nsupport dark mode\nand charts\n",
		);

		deps.log.clear();
		await list(deps, { files: true });

		const out = color.strip(deps.out());
		expect(out).toContain("changed  committed.txt");
		expect(out).toContain("changed  untracked.txt");
		expect(out).toContain("goal     support dark mode");
		expect(out).not.toContain("and charts");
		expect(out).not.toContain("SPLATES.md"); // excluded, so never a change

		deps.log.clear();
		await list(deps, { json: true, files: true });
		const [row] = JSON.parse(deps.out());
		expect(row.changed).toEqual(["committed.txt", "untracked.txt"]);
		expect(row.goal).toBe("support dark mode");
		// Counted as they stand, committed or not.
		expect([row.added, row.removed]).toEqual([2, 0]);
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
