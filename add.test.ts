import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import { ROSTERED } from "./fake-agent";
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

	it("remembers the conversation whose agent added it, for the page to nest it under", async () => {
		deps.proc.env.ARBOR_CONVERSATION = "c1";
		await add(deps, "alpha");
		delete deps.proc.env.ARBOR_CONVERSATION;
		await add(deps, "beta");

		expect((await deps.service.find("alpha")).caller).toBe("c1");
		expect((await deps.service.find("beta")).caller).toBeNull();
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

		await expect(add(deps, "alpha")).toBail("exists", {
			message: "arbor claim alpha",
		});
	});

	it("refuses every add of a name but one when several race", async () => {
		const results = await Promise.allSettled(
			[1, 2, 3].map(() => add(deps, "alpha")),
		);

		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		await Promise.all(
			results
				.filter((result) => result.status === "rejected")
				.map((result) =>
					expect(Promise.reject(result.reason)).toBail("exists", {
						message: "arbor claim alpha",
					}),
				),
		);
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

	it("runs onTree once the worktree exists, before the task is listed", async () => {
		const seen: { exists: boolean; listed: string[] }[] = [];

		await add(deps, "alpha", {
			onTree: async () => {
				seen.push({
					exists: (await deps.service.find("alpha")).exists,
					listed: (await deps.service.list()).map((each) => each.task),
				});
			},
		});

		expect(seen).toEqual([{ exists: true, listed: [] }]);
	});

	it("hands the task to an agent pending while its hook readies the tree", async () => {
		deps.config.postCheckout = `cat ${join(deps.root, ".git", "arbor", "tasks", "alpha.json")} > record.json`;

		await add(deps, "alpha", {
			dispatch: { agent: "fake", model: "Small", prompt: "Do the part." },
			agents: [ROSTERED],
		});

		const found = await deps.service.find("alpha");
		expect(found.state?.dispatch).toEqual({
			agent: "fake",
			model: "small",
			prompt: "Do the part.",
		});
		const during = JSON.parse(
			await deps.fs.read(join(found.path, "record.json")),
		) as { dispatch?: unknown };
		expect(during.dispatch).toEqual({
			agent: "fake",
			model: "small",
			prompt: "Do the part.",
			pending: true,
		});
		expect(deps.out()).toContain("agent:    fake (small)");
		expect(deps.out()).not.toContain("🌱 Added");
	});

	it("tells the agent that added the task to say so as its Added card", async () => {
		await add(deps, "alpha");

		expect(deps.out()).toContain(
			'next:     say "## 🌱 Added alpha" and its Goal before anything else',
		);
	});

	it("hands the task to no agent when its hook fails", async () => {
		deps.config.postCheckout = "exit 3";

		await expect(
			add(deps, "alpha", { dispatch: { agent: "fake" }, agents: [ROSTERED] }),
		).toBail("hook_failed");

		expect((await deps.service.find("alpha")).state?.dispatch).toBeUndefined();
	});

	it("refuses an agent or a model the roster does not list, before making anything", async () => {
		await expect(
			add(deps, "alpha", { dispatch: { agent: "nobody" }, agents: [ROSTERED] }),
		).toBail("usage", {
			message: "no agent 'nobody' on the roster: use one of fake",
		});
		await expect(
			add(deps, "alpha", {
				dispatch: { agent: "fake", model: "huge" },
				agents: [ROSTERED],
			}),
		).toBail("usage", {
			message: "Fake has no model 'huge' on the roster: use one of big, small",
		});
		expect((await deps.service.find("alpha")).gone).toBe(true);
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
