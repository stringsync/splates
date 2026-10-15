import { describe, expect, it } from "bun:test";
import { FileLock } from "webappwiz/system";
import { Projects } from "./projects";
import { Testing } from "./testing";

describe("Projects", () => {
	it("registers a repository once, in the order arbor first ran in each", async () => {
		await using deps = await Testing.open({ init: false });
		const other = `${deps.root}-other`;
		await deps.fs.mkdir(`${other}/.git`);

		await deps.projects.register(deps.root);
		await deps.projects.register(other);
		await deps.projects.register(deps.root);

		const listed = await deps.projects.list();
		expect(listed.map((each) => each.root)).toEqual([deps.root, other]);
		expect(listed.every((each) => !each.gone)).toBe(true);
		expect(Date.parse(listed[0]?.added ?? "")).not.toBeNaN();
	});

	it("focuses a registered repository, else falls back to the first", async () => {
		await using deps = await Testing.open({ init: false });
		const other = `${deps.root}-other`;
		await deps.fs.mkdir(`${other}/.git`);
		expect(await deps.projects.focused()).toBeNull();

		await deps.projects.register(deps.root);
		await deps.projects.register(other);
		expect((await deps.projects.focused())?.root).toBe(deps.root);

		expect(await deps.projects.focus(other)).toBe(true);
		expect(await deps.projects.focus("/nowhere")).toBe(false);
		expect((await deps.projects.focused())?.root).toBe(other);

		await deps.fs.rm(`${other}/.git`, { recursive: true });
		expect((await deps.projects.focused())?.root).toBe(deps.root);
		await deps.projects.forget(other);
		await deps.fs.mkdir(`${other}/.git`);
		await deps.projects.register(other);
		expect((await deps.projects.focused())?.root).toBe(deps.root);
	});

	it("keeps every repository when commands register at once", async () => {
		await using deps = await Testing.open({ init: false });
		const roots = ["a", "b", "c", "d"].map((name) => `${deps.root}-${name}`);
		const registry = (path: string) =>
			new Projects(path, {
				fs: deps.fs,
				lock: new FileLock(`${path}.lock`, {
					fs: deps.fs,
					ps: deps.ps,
					log: deps.log,
					pollMs: 5,
				}),
			});

		await Promise.all(
			roots.map((root) => registry(deps.projects.path).register(root)),
		);

		expect(
			(await deps.projects.list()).map((each) => each.root).sort(),
		).toEqual(roots);
	});

	it("flags a repository that is gone, rather than forgetting it", async () => {
		await using deps = await Testing.open({ init: false });
		const moved = `${deps.root}-moved`;
		await deps.projects.register(moved);

		expect(await deps.projects.list()).toMatchObject([
			{ root: moved, gone: true },
		]);
	});

	it("names each by its root's last part, numbering a second of the same name", async () => {
		await using deps = await Testing.open({ init: false });
		await deps.projects.register("/a/web");
		await deps.projects.register("/b/web");
		await deps.projects.register("/c/api");

		expect((await deps.projects.list()).map((each) => each.slug)).toEqual([
			"web",
			"web-2",
			"api",
		]);
	});

	it("forgets one, leaving the rest", async () => {
		await using deps = await Testing.open({ init: false });
		await deps.projects.register("/a/web");
		await deps.projects.register("/c/api");

		await deps.projects.forget("/a/web");

		expect((await deps.projects.list()).map((each) => each.root)).toEqual([
			"/c/api",
		]);
	});

	it("refuses a registry a newer arbor wrote", async () => {
		await using deps = await Testing.open({ init: false });
		await deps.fs.mkdir(deps.projects.path.replace(/\/[^/]+$/, ""));
		await deps.fs.write(
			deps.projects.path,
			JSON.stringify({ format: 2, projects: [] }),
		);

		await expect(deps.projects.register(deps.root)).toBail("outdated", {
			message: ["written by a newer arbor", "bunx @webappwiz/arbor@latest"],
		});
	});
});
