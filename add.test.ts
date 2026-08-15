import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import type { Config } from "./config";
import { Git } from "./git";
import { Shell } from "./shell";
import { bails, repo, testConfig } from "./testing";
import { WorktreeService } from "./worktree-service";

describe("add", () => {
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		service: WorktreeService;
		shell: Shell;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const service = new WorktreeService(
			new Git(fixture.root, { ps: fixture.ps, fs: fixture.fs }),
			config,
			fixture.arborDir,
			{ fs: fixture.fs, ps: fixture.ps },
		);
		await service.init();
		deps = {
			...fixture,
			config,
			service,
			shell: new Shell({ ps: fixture.ps }),
		};
	});

	afterEach(() => deps.cleanup());

	it("makes a worktree, a branch and a record", async () => {
		await add(deps, "alpha");

		const state = (await deps.service.find("alpha")).state;
		expect(state).toMatchObject({
			task: "alpha",
			branch: "task/alpha",
			status: "working",
			mergeAttempts: 0,
		});
		expect(await deps.fs.exists(join(state?.worktree ?? "", "README.md"))).toBe(
			true,
		);
		expect(
			await deps.gitCli(
				state?.worktree ?? "",
				"rev-parse",
				"--abbrev-ref",
				"HEAD",
			),
		).toBe("task/alpha");
		expect(deps.out()).toContain("added alpha");
	});

	it("leaves a stub ARBOR.md for the agent to fill in", async () => {
		await add(deps, "alpha");

		const state = (await deps.service.find("alpha")).state;
		const plan = await deps.fs.read(join(state?.worktree ?? "", "ARBOR.md"));
		expect(plan).toStartWith("# alpha\n");
		expect(plan).toContain("## Goal");
		expect(plan).toContain("- [ ]");
	});

	it("excludes the plan from git, once, so no task can commit it", async () => {
		await add(deps, "alpha");
		await add(deps, "beta");

		const exclude = await deps.fs.read(
			join(deps.root, ".git", "info", "exclude"),
		);
		expect(exclude.split("\n").filter((line) => line === "ARBOR.md")).toEqual([
			"ARBOR.md",
		]);
		const state = (await deps.service.find("alpha")).state;
		expect(
			await deps.gitCli(state?.worktree ?? "", "status", "--porcelain"),
		).toBe("");
	});

	it("refuses a name that is already taken and points at claim", async () => {
		await add(deps, "alpha");

		const exit = await bails(add(deps, "alpha"));

		expect(exit.reason).toBe("exists");
		expect(exit.message).toContain("arbor claim alpha");
	});

	it("rejects names that are not legal branch or directory names", async () => {
		for (const name of ["Alpha", "a b", "feature/x", "-alpha", ""]) {
			expect((await bails(add(deps, name))).reason).toBe("usage");
		}
	});

	it("reports a failed postCheckout hook but keeps the worktree", async () => {
		deps.config = testConfig(deps.root, { postCheckout: "exit 3" });

		const exit = await bails(add(deps, "alpha"));

		expect(exit.reason).toBe("hook_failed");
		const state = (await deps.service.find("alpha")).state;
		expect(await deps.fs.exists(state?.worktree ?? "")).toBe(true);
	});

	it("refuses with a reason, a message and the data behind it", async () => {
		const exit = await bails(add(deps, "Alpha"));

		expect(exit.reason).toBe("usage");
		expect(exit.message).toContain("invalid task name 'Alpha'");
		expect(exit.data).toEqual({ task: "Alpha" });
	});
});
