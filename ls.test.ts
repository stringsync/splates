import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { color } from "@webappwiz/log";
import { add } from "./add";
import type { Config } from "./config";
import { Git } from "./git";
import { ls } from "./ls";
import { Shell } from "./shell";
import { repo, testConfig } from "./testing";
import { WorktreeService } from "./worktree-service";

describe("ls", () => {
	// ls needs only the service and the log; the rest arranges it with `create`.
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		service: WorktreeService;
		shell: Shell;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const service = new WorktreeService(
			new Git(fixture.root, fixture.ps, fixture.fs),
			config,
			fixture.arborDir,
			fixture.fs,
			fixture.ps,
		);
		await service.init();
		deps = { ...fixture, config, service, shell: new Shell(fixture.ps) };
	});

	afterEach(() => deps.cleanup());

	it("lists tasks, survives a corrupt record, and flags orphans", async () => {
		await add(deps, "alpha");
		await add(deps, "beta");
		await deps.fs.write(deps.service.recordPath("broken"), "{not json");
		const beta = (await deps.service.find("beta")).path;
		await deps.fs.rm(beta, { recursive: true, force: true });

		await ls(deps);

		expect(deps.out()).toContain("alpha");
		expect(deps.out()).toContain("unknown"); // the corrupt row, not a crash
		expect(deps.out()).toContain("orphaned");
		expect(color.strip(deps.out())).toContain("+0 -0");

		deps.log.clear();
		await ls(deps, { json: true });
		const rows = JSON.parse(deps.out());
		expect(rows.map((fixture: { task: string }) => fixture.task)).toEqual([
			"alpha",
			"beta",
			"broken",
		]);
	});

	it("says so plainly when there is nothing to list", async () => {
		await ls(deps);

		expect(deps.out()).toContain("no tasks");
	});
});
