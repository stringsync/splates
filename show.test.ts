import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { escalate } from "./escalate";
import { ROSTERED } from "./fake-agent";
import { show } from "./show";
import { Testing } from "./testing";

describe("show", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("reports a task and prints the ARBOR.md left in its worktree", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/ARBOR.md`,
			"# alpha\n\n## Next\n- [ ] the rest\n",
		);
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain("task/alpha");
		expect(deps.out()).toContain("working");
		expect(deps.out()).toContain("- [ ] the rest");
	});

	it("says how an ARBOR.md departs from the shape the skill prescribes", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/ARBOR.md`,
			"# something else\n\n## Goal\nland it\n",
		);
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain('should be "# alpha"');
		expect(deps.out()).toContain("no ## Next section");
	});

	it("says the ARBOR.md is missing rather than staying silent", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.rm(`${alpha}/ARBOR.md`);
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain("no ARBOR.md");
	});

	it("carries the task's fields and its ARBOR.md as JSON", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(`${alpha}/ARBOR.md`, "# alpha\n");
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

	it("names the systems a task's changed files fall in, from its own config", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/arbor.config.ts`,
			`export default { systems: { docs: { globs: ["*.md"] }, code: { globs: ["*.ts"], ignore: ["arbor.config.ts"] } } };\n`,
		);
		await deps.fs.write(`${alpha}/notes.md`, "a\n");
		deps.log.clear();

		await show(deps, "alpha");

		expect(deps.out()).toContain("systems:   docs\n");
	});

	it("names no systems while its config will not load", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.fs.write(
			`${alpha}/arbor.config.ts`,
			`import "./nowhere";\nexport default {};\n`,
		);
		deps.log.clear();

		await show(deps, "alpha", { json: true });

		expect(JSON.parse(deps.out()).systems).toEqual([]);
	});

	it("says a task waiting on approval is ready to merge, and what to look at", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await deps.finish(alpha);
		await escalate(deps, "drag a todo on the board", alpha, { review: true });
		deps.log.clear();

		await show(deps, "alpha", { json: true });

		const details = JSON.parse(deps.out());
		expect(details).toMatchObject({
			status: "escalated",
			review: "drag a todo on the board",
			ready: true,
		});
		// A review asks no question, so it leaves no ## Blocked behind.
		expect(details.planProblems.join("\n")).not.toContain("## Blocked");
	});

	it("says when a task escalated, only while it is", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		deps.log.clear();
		await show(deps, "alpha", { json: true });
		expect(JSON.parse(deps.out()).escalatedAt).toBeNull();

		await escalate(deps, "needs a human", alpha);
		deps.log.clear();
		await show(deps, "alpha", { json: true });

		const { escalatedAt } = JSON.parse(deps.out());
		expect(Date.parse(escalatedAt)).toBeGreaterThan(Date.now() - 60_000);
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
		expect(deps.out()).not.toContain("no ARBOR.md");
	});
});
