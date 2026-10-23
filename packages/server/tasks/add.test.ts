import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import { decodeTask } from "../board";
import { Testing } from "../testing";
import { add } from "./add";

const ROSTERED = {
	id: "fake",
	name: "Fake",
	argv: ["fake-acp"],
	models: [
		{ id: "big", name: "Big", strengths: "hard problems", cost: "high" },
		{ id: "small", name: "Small", strengths: "quick edits", cost: "low" },
	],
};

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
		expect(deps.out()).not.toContain("notes:");
	});

	it.each(["notes", "project-notes"])(
		"points at the notes in %s when starting a queued task",
		async (directory) => {
			deps.config.notesDir = directory;
			await deps.fs.mkdir(`${deps.root}/${directory}`);
			await deps.commit(
				deps.root,
				`${directory}/conventions.md`,
				"---\ndescription: Project conventions\n---\n\nUse named exports.\n",
				"Add conventions",
			);
			await deps.commit(
				deps.root,
				`${directory}/decisions.md`,
				"---\ndescription: Project decisions\n---\n\nKeep notes short.\n",
				"Add decisions",
			);
			const queued = await deps.tasks.add("Use the notes", null);

			await add(deps, "alpha", { tasks: [queued.id] });

			expect(deps.out()).toContain("notes: 2, splates notes lists them");
			expect(deps.out()).not.toContain("Project conventions");
			expect(deps.out()).not.toContain("Project decisions");
		},
	);

	it("remembers the conversation whose agent added it, for the page to nest it under", async () => {
		deps.proc.env.SPLATES_CONVERSATION = "c1";
		await add(deps, "alpha");
		delete deps.proc.env.SPLATES_CONVERSATION;
		await add(deps, "beta");

		expect((await deps.service.find("alpha")).caller).toBe("c1");
		expect((await deps.service.find("beta")).caller).toBeNull();
	});

	it("leaves a SPLATES.md holding only its Goal", async () => {
		await add(deps, "alpha", { goal: "Stop the retries." });

		const state = (await deps.service.find("alpha")).state;
		const plan = await deps.fs.read(join(state?.worktree ?? "", "SPLATES.md"));
		expect(plan).toBe("# alpha\n\n## Goal\n\nStop the retries.\n");
	});

	it("puts the Goal it is given ahead of what its queued tasks seed", async () => {
		const queued = await deps.tasks.add("Retry on 413", null, {
			text: "in upload.ts",
		});
		await add(deps, "alpha", { goal: "Stop the retries.", tasks: [queued.id] });

		const { path } = await deps.service.find("alpha");
		expect(await deps.fs.read(join(path, "SPLATES.md"))).toContain(
			"## Goal\n\nStop the retries.\n\nRetry on 413\n\nin upload.ts",
		);
	});

	it("excludes the plan from git, once, so no task can commit it", async () => {
		await add(deps, "alpha");
		await add(deps, "beta");

		const exclude = await deps.fs.read(
			join(deps.root, ".git", "info", "exclude"),
		);
		expect(exclude.split("\n").filter((line) => line === "SPLATES.md")).toEqual(
			["SPLATES.md"],
		);
		const state = (await deps.service.find("alpha")).state;
		expect(
			await deps.gitCli(state?.worktree ?? "", "status", "--porcelain"),
		).toBe("");
	});

	it("refuses a name that is already taken and points at claim", async () => {
		await add(deps, "alpha");

		await expect(add(deps, "alpha")).toBail("exists", {
			message: "splates claim alpha",
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
						message: "splates claim alpha",
					}),
				),
		);
	});

	// scry-ignore simple-test-setup: the queued task is the input these adds race and roll back over; the other tests take none.
	it("leaves no worktree behind when another add takes its queued task first", async () => {
		const queued = await deps.tasks.add("Retry on 413", null);
		const results = await Promise.allSettled([
			add(deps, "alpha", { tasks: [queued.id] }),
			add(deps, "beta", { tasks: [queued.id] }),
		]);

		const won = results.findIndex((result) => result.status === "fulfilled");
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const loser = won === 0 ? "beta" : "alpha";
		expect((await deps.service.find(loser)).exists).toBe(false);
		expect((await deps.tasks.find(queued.id)).takenBy).toBe(
			won === 0 ? "alpha" : "beta",
		);
	});

	// scry-ignore simple-test-setup: the queued task is the input the failed add must put back; the other tests take none.
	it("puts its queued tasks back when the worktree cannot be made", async () => {
		const queued = await deps.tasks.add("Retry on 413", null);

		await expect(
			add(deps, "alpha", { tasks: [queued.id], base: "no-such-branch" }),
		).rejects.toThrow();

		expect((await deps.tasks.find(queued.id)).takenBy).toBeNull();
	});

	// scry-ignore simple-test-setup: the queued task is the input a failed hook must put back; the other tests take none.
	it("puts its queued tasks back when the postCheckout hook fails", async () => {
		deps.config.postCheckout = "exit 3";
		const queued = await deps.tasks.add("Retry on 413", null);

		await expect(add(deps, "alpha", { tasks: [queued.id] })).toBail(
			"hook_failed",
		);

		expect((await deps.tasks.find(queued.id)).takenBy).toBeNull();
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
		deps.config.postCheckout = "printenv SPLATES_TRUNK > trunk.txt";

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
		// Reads the record out of the database, as an agent's hook would.
		const reader =
			'const { Database } = require("bun:sqlite");' +
			`const row = new Database(${JSON.stringify(join(deps.dir, "state.db"))}, { readonly: true }).query("SELECT data FROM kv WHERE key = ?").get("tasks/1.md");` +
			'require("node:fs").writeFileSync("record.md", row.data);';
		deps.config.postCheckout = `bun -e '${reader}'`;

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
		const during = decodeTask(
			await deps.fs.read(join(found.path, "record.md")),
		) as { dispatch?: unknown };
		expect(during.dispatch).toEqual({
			agent: "fake",
			model: "small",
			prompt: "Do the part.",
			pending: true,
		});
		expect(deps.out()).toContain("agent:    fake (small)");
		// Free for the agent to claim at once, from whatever host it runs on.
		expect(found.lease).toBeNull();
	});

	it("leaves saying it was added to splates's own line, telling the agent nothing to say", async () => {
		await add(deps, "alpha");

		expect(deps.out()).not.toContain("next:");
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

	it("refuses to hand the task to an agent from an agent, before making anything", async () => {
		deps.proc.env.SPLATES_CONVERSATION = "c2";

		await expect(
			add(deps, "alpha", { dispatch: { agent: "fake" }, agents: [ROSTERED] }),
		).toBail("usage", {
			message: ["an agent starts no agents", "splates task add"],
			data: { task: "alpha", caller: "c2" },
		});
		expect((await deps.service.find("alpha")).gone).toBe(true);
		await add(deps, "alpha");
		expect((await deps.service.find("alpha")).caller).toBe("c2");
	});

	it("refuses an agent a part of its task, before making anything", async () => {
		await add(deps, "alpha");
		deps.proc.env.SPLATES_CONVERSATION = "c1";

		await expect(add(deps, "beta", { base: "task/alpha" })).toBail("usage", {
			message: ["a subagent works in your own worktree", "splates task add"],
			data: { task: "beta", base: "task/alpha" },
		});
		expect((await deps.service.find("beta")).gone).toBe(true);
	});

	it("names the trunk and the config when the trunk is not a branch", async () => {
		deps.config.trunk = "master";

		await expect(add(deps, "alpha")).toBail("usage", {
			message: ["trunk 'master'", "splates.config.ts"],
		});
	});

	it("refuses with a reason, a message and the data behind it", async () => {
		await expect(add(deps, "Alpha")).toBail("usage", {
			message: "invalid task name 'Alpha'",
			data: { task: "Alpha" },
		});
	});
});
