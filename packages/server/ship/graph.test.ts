import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { movePins, readGraph } from "./graph";
import { servedProjects } from "./testing";

describe("readGraph", () => {
	it("draws who pins whose public packages across the served projects", async () => {
		const { fs, sources } = await servedProjects();

		const graph = await readGraph(fs, sources);

		const of = (slug: string) =>
			graph.projects.find((each) => each.slug === slug);
		expect(of("webappwiz")?.packages).toEqual(["@webappwiz/cli", "webappwiz"]);
		expect(of("webappwiz")?.uses).toEqual([]);
		expect(of("webappwiz")?.dependents.map((each) => each.project)).toEqual([
			"splates",
			"mdom",
			"vexml",
			"sound2score",
		]);
		expect(of("splates")?.packages).toEqual(["@stringsync/splates-server"]);
		expect(of("splates")?.uses).toEqual([
			{
				project: "webappwiz",
				pins: [
					{ name: "@webappwiz/cli", version: "0.0.50" },
					{ name: "webappwiz", version: "0.0.50" },
				],
			},
		]);
		expect(of("mdom")?.dependents.map((each) => each.project)).toEqual([
			"vexml",
			"sound2score",
		]);
		expect(of("vexml")?.dependents.map((each) => each.project)).toEqual([
			"sound2score",
		]);
		expect(of("sound2score")?.private).toBe(true);
		expect(of("sound2score")?.dependents).toEqual([]);
		expect(of("sound2score")?.version).toBe("0.1.0");
	});

	it("retains differing pins across workspace manifests", async () => {
		const { fs, sources } = await servedProjects();
		const path = "/splates/packages/server/package.json";
		const manifest = JSON.parse(await fs.read(path));
		manifest.dependencies.webappwiz = "0.0.51";
		await fs.write(path, JSON.stringify(manifest));
		const graph = await readGraph(fs, sources);
		expect(
			graph.projects.find((project) => project.slug === "splates")?.uses[0]
				?.pins,
		).toEqual([
			{ name: "@webappwiz/cli", version: "0.0.50" },
			{ name: "webappwiz", version: "0.0.50" },
			{ name: "webappwiz", version: "0.0.51" },
		]);
	});

	it("draws no edge for a workspace pin or a package of no registered project", async () => {
		const fs = new FakeFs();
		await fs.write(
			"/a/package.json",
			JSON.stringify({
				name: "a",
				dependencies: { zod: "^4", a: "workspace:*" },
			}),
		);

		const graph = await readGraph(fs, [{ slug: "a", root: "/a", ship: null }]);

		expect(graph.projects[0]?.uses).toEqual([]);
		expect(graph.projects[0]?.packages).toEqual(["a"]);
	});

	it("reads a project with no package.json as publishing and pinning nothing", async () => {
		const graph = await readGraph(new FakeFs(), [
			{ slug: "bare", root: "/bare", ship: null },
		]);

		expect(graph.projects[0]).toMatchObject({
			packages: [],
			private: true,
			version: null,
		});
	});

	it("moves pins in the root and workspace manifests, keeping range marks and workspace pins", async () => {
		const fs = new FakeFs();
		await fs.mkdir("/p/packages/a", { recursive: true });
		await fs.mkdir("/p/packages/b", { recursive: true });
		await fs.write(
			"/p/package.json",
			JSON.stringify({
				workspaces: ["packages/*"],
				dependencies: { webappwiz: "^0.0.50", other: "1.0.0" },
			}),
		);
		await fs.write(
			"/p/packages/a/package.json",
			JSON.stringify({ devDependencies: { webappwiz: "workspace:*" } }),
		);
		await fs.write(
			"/p/packages/b/package.json",
			JSON.stringify({ devDependencies: { webappwiz: "0.0.50" } }),
		);

		const changed = await movePins(fs, "/p", [
			{ name: "webappwiz", version: "0.0.51" },
		]);

		expect(changed).toEqual(["/p/package.json", "/p/packages/b/package.json"]);
		expect(JSON.parse(await fs.read("/p/package.json")).dependencies).toEqual({
			webappwiz: "^0.0.51",
			other: "1.0.0",
		});
		expect(
			JSON.parse(await fs.read("/p/packages/b/package.json")).devDependencies,
		).toEqual({ webappwiz: "0.0.51" });
	});
});
