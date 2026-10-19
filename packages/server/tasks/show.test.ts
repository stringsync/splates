import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { utimes } from "node:fs/promises";
import { ROSTERED } from "../agents/testing";
import { Testing } from "../testing";
import { add } from "./add";
import { claim } from "./claim";
import { show } from "./show";

describe("show", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	const takenBy = async (task: string) => {
		deps.log.clear();
		await show(deps, task, { json: true });
		return JSON.parse(deps.out()).takenBy;
	};

	it("reports a task and prints the SPLATES.md left in its worktree", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/SPLATES.md`,
			"# alpha\n\n## Next\n- [ ] the rest\n",
		);
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain("task/alpha");
		expect(deps.out()).toContain("working");
		expect(deps.out()).toContain("- [ ] the rest");
	});

	it("says how an SPLATES.md departs from the shape the skill prescribes", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/SPLATES.md`,
			"# something else\n\n## Goal\nland it\n",
		);
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain('should be "# alpha"');
		expect(deps.out()).not.toContain("## Next");
	});

	it("says the SPLATES.md is missing rather than staying silent", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.rm(`${alpha}/SPLATES.md`);
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain("no SPLATES.md");
	});

	it("carries the task's fields and its SPLATES.md as JSON", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(`${alpha}/SPLATES.md`, "# alpha\n");
		deps.log.clear();

		await show(deps, "alpha", { json: true });

		expect(JSON.parse(deps.out())).toMatchObject({
			task: "alpha",
			status: "working",
			branch: "task/alpha",
			ahead: 0,
			plan: "# alpha\n",
		});
	});

	it("carries the page conversation that last took it, none once an agent outside the page claims it", async () => {
		await deps.fs.mkdir(`${deps.splatesDir}/conversations`);
		await deps.fs.write(`${deps.splatesDir}/conversations/c1.jsonl`, "");
		deps.proc.env.SPLATES_CONVERSATION = "c1";
		await add(deps, "alpha");
		delete deps.proc.env.SPLATES_CONVERSATION;

		expect(await takenBy("alpha")).toBe("c1");
		await claim(deps, "alpha");
		expect(await takenBy("alpha")).toBeNull();
	});

	it("takes an agent from another project's page for one outside the page", async () => {
		deps.proc.env.SPLATES_CONVERSATION = "elsewhere";
		await add(deps, "alpha");
		delete deps.proc.env.SPLATES_CONVERSATION;

		expect(await takenBy("alpha")).toBeNull();
	});

	it("dates the last sign of work in it by its newest edit not yet committed", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(`${alpha}/notes.md`, "half done\n");
		const later = new Date(Date.now() + 60 * 60 * 1000);
		later.setMilliseconds(0);
		await utimes(`${alpha}/notes.md`, later, later);
		deps.log.clear();

		await show(deps, "alpha", { json: true });

		expect(JSON.parse(deps.out()).activeAt).toBe(later.toISOString());
	});

	it("has unmerged changes only with commits its base lacks or edits besides its SPLATES.md", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		const unmerged = async () => {
			deps.log.clear();
			await show(deps, "alpha", { json: true });
			return JSON.parse(deps.out()).unmerged;
		};
		await deps.fs.write(`${alpha}/SPLATES.md`, "# alpha\n");
		expect(await unmerged()).toBe(false);

		await deps.fs.write(`${alpha}/README.md`, "edited\n");
		expect(await unmerged()).toBe(true);
		await deps.gitCli(alpha, "checkout", "README.md");
		await deps.fs.write(`${alpha}/notes.md`, "half done\n");
		expect(await unmerged()).toBe(true);
		await deps.fs.rm(`${alpha}/notes.md`);

		await deps.commit(alpha, "feature.ts", "x\n", "feature");
		expect(await unmerged()).toBe(true);
	});

	it("has no unmerged changes once its branch is reset behind its base", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.commit(deps.root, "later.md", "later\n", "later");
		await deps.gitCli(alpha, "reset", "--hard", "main~1");
		deps.log.clear();

		await show(deps, "alpha", { json: true });

		expect(JSON.parse(deps.out())).toMatchObject({ ahead: 0, unmerged: false });
	});

	it("says a task is handed to an agent until its conversation starts", async () => {
		await add(deps, "alpha", {
			dispatch: { agent: "fake" },
			agents: [ROSTERED],
		});
		deps.log.clear();
		await show(deps, "alpha", { json: true });
		expect(JSON.parse(deps.out()).dispatched).toBe(true);

		await (await deps.service.find("alpha")).save({
			dispatch: { agent: "fake", conversation: "c1" },
		});
		deps.log.clear();
		await show(deps, "alpha", { json: true });

		expect(JSON.parse(deps.out()).dispatched).toBe(false);
	});

	it("refuses a task that was never created", async () => {
		await expect(show(deps, "ghost")).toBail("not_found");
	});

	it("still describes a task whose worktree is gone", async () => {
		await add(deps, "alpha");
		await deps.fs.rm((await deps.service.find("alpha")).path, {
			recursive: true,
			force: true,
		});
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain("orphaned");
		expect(deps.out()).not.toContain("no SPLATES.md");
	});
});
