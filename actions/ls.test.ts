import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { color } from "@webappwiz/log";
import type { Config } from "../lib/config";
import { CliGit } from "../lib/git";
import { PosixShell, type Shell } from "../lib/shell";
import { repo, testConfig } from "../lib/testing";
import { GitWorktreeStore, type WorktreeStore } from "../lib/worktree-store";
import { create } from "./create";
import { ls } from "./ls";

describe("ls", () => {
	// ls needs only the store and the log; the rest arranges it with `create`.
	let d: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		store: WorktreeStore;
		shell: Shell;
	};

	beforeEach(async () => {
		const r = await repo();
		const config = testConfig(r.root);
		const store = new GitWorktreeStore(
			r.fs,
			r.ps,
			new CliGit(r.ps, r.fs, r.root),
			config,
			r.arborDir,
		);
		await store.init();
		d = { ...r, config, store, shell: new PosixShell(r.ps) };
	});

	afterEach(() => d.cleanup());

	it("lists tasks, survives a corrupt record, and flags orphans", async () => {
		await create(d, "alpha");
		await create(d, "beta");
		await d.fs.write(d.store.recordPath("broken"), "{not json");
		const beta = (await d.store.find("beta")).path;
		await d.fs.rm(beta, { recursive: true, force: true });

		await ls(d);

		expect(d.out()).toContain("alpha");
		expect(d.out()).toContain("unknown"); // the corrupt row, not a crash
		expect(d.out()).toContain("orphaned");
		expect(color.strip(d.out())).toContain("+0 -0");

		d.log.clear();
		await ls(d, { json: true });
		const rows = JSON.parse(d.out());
		expect(rows.map((r: { task: string }) => r.task)).toEqual([
			"alpha",
			"beta",
			"broken",
		]);
	});

	it("says so plainly when there is nothing to list", async () => {
		await ls(d);

		expect(d.out()).toContain("no workstreams");
	});
});
