import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { basename, join } from "node:path";
import { Testing } from "@stringsync/splates-server/testing";
import { projectArgs, splates } from "./splates";

/**
 * Two projects on one machine, the first's registry naming both, its agent
 * running `splates` on the second with `--project`.
 */
describe("splates across projects", () => {
	let here: Testing;
	let there: Testing;
	let deps: Parameters<typeof splates.run>[0];
	let hereSlug: string;
	let thereSlug: string;

	beforeEach(async () => {
		here = await Testing.open();
		there = await Testing.open();
		await here.projects.register(there.root);
		const listed = await here.projects.list();
		const slug = (root: string) =>
			listed.find((each) => each.root === root)?.slug ?? "";
		hereSlug = slug(here.root);
		thereSlug = slug(there.root);
		here.ps.cd(here.root);
		deps = {
			log: here.log,
			fs: here.fs,
			ps: here.ps,
			assets: here.assets,
			secrets: here.secrets,
		};
	});

	afterEach(async () => {
		await here.disposeAsync();
		await there.disposeAsync();
	});

	/** Runs `splates --project <there> ...args` from here. */
	const onThere = (...args: string[]) =>
		splates.run({ ...deps, project: thereSlug }, args);

	it("splits a leading --project off the arguments", () => {
		expect(projectArgs(["--project", "shop", "list"])).toEqual({
			project: "shop",
			argv: ["list"],
		});
		expect(projectArgs(["--project=shop", "list"])).toEqual({
			project: "shop",
			argv: ["list"],
		});
		expect(projectArgs(["list", "--project", "shop"])).toEqual({
			argv: ["list", "--project", "shop"],
		});
	});

	it("queues a task in its untriaged lane, saying where it came from", async () => {
		await splates.run(deps, ["add", "alpha", "--goal", "Land it."]);
		here.ps.cd((await here.service.find("alpha")).path);

		await onThere("task", "add", "Export the parser");

		const [queued] = await there.tasks.all();
		expect(queued?.state).toMatchObject({
			subject: "Export the parser",
			from: null,
			lane: null,
			origin: { project: here.root, task: "alpha" },
		});
		expect(await here.tasks.all()).toEqual([]);

		await onThere("task", "show", String(queued?.id));
		expect(String(here.log.entries.at(-1)?.message)).toContain(
			`from:      ${basename(here.root)}/alpha`,
		);
	});

	it("refuses a lane for a queued task from another project", async () => {
		await onThere("task", "add", "Export the parser", "--lane", "new");

		expect(here.out()).toContain('"reason":"not_granted"');
		expect(await there.tasks.all()).toEqual([]);
	});

	it("refuses what the other project has not granted, until it does", async () => {
		await onThere("task", "add", "Export the parser");
		await onThere("task", "remove", "1");
		expect(here.out()).toContain('"reason":"not_granted"');
		expect(here.out()).toContain(`splates projects grant ${hereSlug} tasks`);
		expect(await there.tasks.all()).toHaveLength(1);

		// The person, in the other project's main tree.
		here.ps.cd(there.root);
		await splates.run(deps, ["projects", "grant", hereSlug, "tasks"]);
		expect(await here.projects.reach(here.root, there.root)).toBe("tasks");

		here.ps.cd(here.root);
		await onThere("task", "remove", "1");
		expect(await there.tasks.all()).toEqual([]);
	});

	it("starts no task in another project, granted or not, so it is queued there", async () => {
		await here.projects.grant(there.root, here.root, "tasks");

		await onThere("add", "beta", "--goal", "Do it.", "--agent", "claude");

		expect(here.out()).toContain('"reason":"not_granted"');
		expect(here.out()).toContain("task add");
		expect((await there.service.find("beta")).gone).toBe(true);
	});

	it("refuses a command only a project runs on itself", async () => {
		await here.projects.grant(there.root, here.root, "tasks");

		await onThere("projects", "grant", hereSlug, "tasks");

		expect(here.out()).toContain('"reason":"not_granted"');
	});

	it("checks an agent of this project's page that changes into the other", async () => {
		await here.projects.grant(there.root, here.root, "read");
		await here.fs.mkdir(join(here.root, ".git/splates/conversations"));
		await here.fs.write(
			join(here.root, ".git/splates/conversations/c1.jsonl"),
			"",
		);
		here.proc.env.SPLATES_CONVERSATION = "c1";
		here.ps.cd(there.root);

		await splates.run(deps, ["task", "add", "Export the parser"]);
		expect(here.out()).toContain('"reason":"not_granted"');
		expect(await there.tasks.all()).toEqual([]);

		await splates.run(deps, ["task", "list", "--json"]);
		expect(JSON.parse(String(here.log.entries.at(-1)?.message))).toEqual([]);
	});

	it("lists what each project may do in the other", async () => {
		await here.projects.grant(there.root, here.root, "tasks");

		await splates.run(deps, ["projects", "list", "--json"]);

		expect(JSON.parse(String(here.log.entries.at(-1)?.message))).toEqual([
			{
				slug: thereSlug,
				root: there.root,
				gone: false,
				here: "queue",
				there: "tasks",
			},
		]);
	});
});
