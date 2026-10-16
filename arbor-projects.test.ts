import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { basename, join } from "node:path";
import { arbor, projectArgs } from "./arbor";
import { Testing } from "./testing";

/**
 * Two projects on one machine, the first's registry naming both, its agent
 * running `arbor` on the second with `--project`.
 */
describe("arbor across projects", () => {
	let here: Testing;
	let there: Testing;
	let deps: Parameters<typeof arbor.run>[0];
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

	/** Runs `arbor --project <there> ...args` from here. */
	const onThere = (...args: string[]) =>
		arbor.run({ ...deps, project: thereSlug }, args);

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

	it("adds a todo to its untriaged lane, saying where it came from", async () => {
		await arbor.run(deps, ["add", "alpha", "--goal", "Land it."]);
		here.ps.cd((await here.service.find("alpha")).path);

		await onThere("todo", "add", "Export the parser");

		const [todo] = await there.todos.all();
		expect(todo?.state).toMatchObject({
			subject: "Export the parser",
			from: null,
			lane: null,
			origin: { project: here.root, task: "alpha" },
		});
		expect(await here.todos.all()).toEqual([]);

		await onThere("todo", "show", String(todo?.id));
		expect(String(here.log.entries.at(-1)?.message)).toContain(
			`from:      ${basename(here.root)}/alpha`,
		);
	});

	it("refuses a lane for a todo from another project", async () => {
		await onThere("todo", "add", "Export the parser", "--lane", "new");

		expect(here.out()).toContain('"reason":"not_granted"');
		expect(await there.todos.all()).toEqual([]);
	});

	it("refuses what the other project has not granted, until it does", async () => {
		await onThere("add", "beta", "--goal", "Do it.", "--agent", "claude");
		expect(here.out()).toContain('"reason":"not_granted"');
		expect(here.out()).toContain(`arbor projects grant ${hereSlug} tasks`);
		expect((await there.service.find("beta")).gone).toBe(true);

		// The person, in the other project's main tree.
		here.ps.cd(there.root);
		await arbor.run(deps, ["projects", "grant", hereSlug, "tasks"]);
		expect(await here.projects.reach(here.root, there.root)).toBe("tasks");

		here.ps.cd(here.root);
		await onThere("add", "beta", "--goal", "Do it.", "--agent", "claude");
		expect((await there.service.find("beta")).gone).toBe(false);
	});

	it("hands a task in another project to an agent, never taking it", async () => {
		await here.projects.grant(there.root, here.root, "tasks");

		await onThere("add", "beta", "--goal", "Do it.");

		expect(here.out()).toContain("--agent");
		expect((await there.service.find("beta")).gone).toBe(true);
	});

	it("refuses a command only a project runs on itself", async () => {
		await here.projects.grant(there.root, here.root, "tasks");

		await onThere("projects", "grant", hereSlug, "tasks");

		expect(here.out()).toContain('"reason":"not_granted"');
	});

	it("checks an agent of this project's page that changes into the other", async () => {
		await here.projects.grant(there.root, here.root, "read");
		await here.fs.mkdir(join(here.root, ".git/arbor/conversations"));
		await here.fs.write(
			join(here.root, ".git/arbor/conversations/c1.jsonl"),
			"",
		);
		here.proc.env.ARBOR_CONVERSATION = "c1";
		here.ps.cd(there.root);

		await arbor.run(deps, ["todo", "add", "Export the parser"]);
		expect(here.out()).toContain('"reason":"not_granted"');
		expect(await there.todos.all()).toEqual([]);

		await arbor.run(deps, ["todo", "list", "--json"]);
		expect(JSON.parse(String(here.log.entries.at(-1)?.message))).toEqual([]);
	});

	it("lists what each project may do in the other", async () => {
		await here.projects.grant(there.root, here.root, "tasks");

		await arbor.run(deps, ["projects", "list", "--json"]);

		expect(JSON.parse(String(here.log.entries.at(-1)?.message))).toEqual([
			{
				slug: thereSlug,
				root: there.root,
				gone: false,
				here: "todos",
				there: "tasks",
			},
		]);
	});
});
