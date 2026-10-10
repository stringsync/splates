import { describe, expect, it } from "bun:test";
import { FileLock } from "webappwiz/system";
import { Projects } from "./projects";
import { Testing } from "./testing";

describe("Projects", () => {
	it("registers a repository once, in the order arbor first ran in each", async () => {
		await using deps = await Testing.open();
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

	it("keeps every repository when commands register at once", async () => {
		await using deps = await Testing.open();
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
		await using deps = await Testing.open();
		const moved = `${deps.root}-moved`;
		await deps.projects.register(moved);

		expect(await deps.projects.list()).toMatchObject([
			{ root: moved, gone: true },
		]);
	});

	it("refuses a registry a newer arbor wrote", async () => {
		await using deps = await Testing.open();
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
