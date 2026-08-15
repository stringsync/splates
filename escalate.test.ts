import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FileLock } from "@webappwiz/system";
import { add } from "./add";
import type { Config } from "./config";
import { escalate } from "./escalate";
import { Git } from "./git";
import { Shell } from "./shell";
import { bails, repo, testConfig } from "./testing";
import { WorktreeService } from "./worktree-service";

describe("escalate", () => {
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		git: Git;
		service: WorktreeService;
		shell: Shell;
		lock: FileLock;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const git = new Git(fixture.root, { ps: fixture.ps, fs: fixture.fs });
		const service = new WorktreeService(git, config, fixture.arborDir, {
			fs: fixture.fs,
			ps: fixture.ps,
		});
		await service.init();
		deps = {
			...fixture,
			config,
			git,
			service,
			shell: new Shell({ ps: fixture.ps }),
			lock: new FileLock(join(fixture.arborDir, "merge.lock"), {
				fs: fixture.fs,
				ps: fixture.ps,
				log: fixture.log,
				stalenessMs: config.leaseStalenessMs,
			}),
		};
	});

	afterEach(() => deps.cleanup());

	it("records the reason, drops the lease, and leaves the tree alone", async () => {
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.fs.write(join(worktree, "half-done.txt"), "work in progress\n");

		await escalate(deps, "both sides restructured the router", worktree);

		const state = (await deps.service.find("alpha")).state;
		expect(state).toMatchObject({ status: "escalated", lease: null });
		expect(state?.escalations).toHaveLength(1);
		expect(await deps.fs.exists(join(worktree, "half-done.txt"))).toBe(true);

		await escalate(deps, "second thoughts", worktree);
		expect((await deps.service.find("alpha")).state?.escalations).toHaveLength(
			2,
		);
	});

	it("requires an explicit task when run outside a worktree", async () => {
		await add(deps, "alpha");

		const exit = await bails(escalate(deps, "needs a human", deps.root));

		expect(exit.reason).toBe("usage");
		expect(exit.message).toContain("--task");

		await escalate(deps, "needs a human", deps.root, "alpha");
		expect((await deps.service.find("alpha")).state?.status).toBe("escalated");
	});
});
