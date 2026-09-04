import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import { Testing } from "./testing";

describe("add", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

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
		expect(plan).toContain("## Files");
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

		await expect(add(deps, "alpha")).toBail("exists", {
			message: "arbor claim alpha",
		});
	});

	it("rejects names that are not legal branch or directory names", async () => {
		const names = ["Alpha", "a b", "feature/x", "-alpha", ""];

		await Promise.all(
			names.map((name) => expect(add(deps, name)).toBail("usage")),
		);
	});

	it("refuses a repo with submodules, before making anything", async () => {
		await deps.fs.write(join(deps.root, ".gitmodules"), "");

		await expect(add(deps, "alpha")).toBail("usage", {
			message: ".gitmodules",
		});
		expect((await deps.service.find("alpha")).gone).toBe(true);
	});

	it("reports a failed postCheckout hook but keeps the worktree", async () => {
		deps.config.postCheckout = "exit 3";

		await expect(add(deps, "alpha")).toBail("hook_failed");
		const state = (await deps.service.find("alpha")).state;
		expect(await deps.fs.exists(state?.worktree ?? "")).toBe(true);
	});

	it("tells the postCheckout hook which branch the trunk is", async () => {
		deps.config.trunk = "master";
		deps.config.postCheckout = "printenv ARBOR_TRUNK > trunk.txt";

		await add(deps, "alpha", { base: "main" });

		const state = (await deps.service.find("alpha")).state;
		expect(await deps.fs.read(join(state?.worktree ?? "", "trunk.txt"))).toBe(
			"master\n",
		);
	});

	it("names the trunk and the config when the trunk is not a branch", async () => {
		deps.config.trunk = "master";

		await expect(add(deps, "alpha")).toBail("usage", {
			message: ["trunk 'master'", "arbor.config.ts"],
		});
	});

	it("refuses with a reason, a message and the data behind it", async () => {
		await expect(add(deps, "Alpha")).toBail("usage", {
			message: "invalid task name 'Alpha'",
			data: { task: "Alpha" },
		});
	});
});
