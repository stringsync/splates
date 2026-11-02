import { describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { movePins, readGraph } from "./graph";
import { servedProjects } from "./testing";

describe("readGraph", () => {
	it("draws each ship target of one repository from the manifests under its paths", async () => {
		const fs = new FakeFs();
		const json = async (path: string, value: object) => {
			await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
			await fs.write(path, JSON.stringify(value));
		};
		await json("/repo/package.json", {
			private: true,
			workspaces: ["*/packages/*"],
		});
		await json("/repo/mdom/packages/mdom/package.json", {
			name: "@stringsync/mdom",
			version: "1.2.0",
		});
		await json("/repo/vexml/packages/vexml/package.json", {
			name: "@stringsync/vexml",
			version: "3.0.0",
			dependencies: { "@stringsync/mdom": "^1.1.0" },
		});

		const graph = await readGraph(fs, [
			{ slug: "mdom", root: "/repo", paths: ["mdom/**"], ship: "a" },
			{ slug: "vexml", root: "/repo", paths: ["vexml/**"], ship: "b" },
		]);

		const [mdom, vexml] = graph.projects;
		expect(mdom?.packages).toEqual(["@stringsync/mdom"]);
		expect(mdom?.version).toBe("1.2.0");
		expect(vexml?.packages).toEqual(["@stringsync/vexml"]);
		expect(vexml?.version).toBe("3.0.0");
		expect(vexml?.uses.map((each) => each.project)).toEqual(["mdom"]);
		expect(mdom?.dependents.map((each) => each.project)).toEqual(["vexml"]);
	});

	it("draws who pins whose public packages across the served projects", async () => {
		const { fs, sources } = await servedProjects();

		const graph = await readGraph(fs, sources);

		const of = (slug: string) =>
			graph.projects.find((each) => each.slug === slug);
		expect(of("wren")?.packages).toEqual(["@wren/cli", "wren"]);
		expect(of("wren")?.uses).toEqual([]);
		expect(of("wren")?.dependents.map((each) => each.project)).toEqual([
			"splates",
			"mdom",
			"vexml",
			"sound2score",
		]);
		expect(of("splates")?.packages).toEqual(["@splates/server"]);
		expect(of("splates")?.uses).toEqual([
			{
				project: "wren",
				pins: [
					{ name: "@wren/cli", version: "0.0.50" },
					{ name: "wren", version: "0.0.50" },
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
		manifest.dependencies.wren = "0.0.51";
		await fs.write(path, JSON.stringify(manifest));
		const graph = await readGraph(fs, sources);
		expect(
			graph.projects.find((project) => project.slug === "splates")?.uses[0]
				?.pins,
		).toEqual([
			{ name: "@wren/cli", version: "0.0.50" },
			{ name: "wren", version: "0.0.50" },
			{ name: "wren", version: "0.0.51" },
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
				dependencies: { wren: "^0.0.50", other: "1.0.0" },
			}),
		);
		await fs.write(
			"/p/packages/a/package.json",
			JSON.stringify({ devDependencies: { wren: "workspace:*" } }),
		);
		await fs.write(
			"/p/packages/b/package.json",
			JSON.stringify({ devDependencies: { wren: "0.0.50" } }),
		);

		const changed = await movePins(fs, "/p", [
			{ name: "wren", version: "0.0.51" },
		]);

		expect(changed).toEqual(["/p/package.json", "/p/packages/b/package.json"]);
		expect(JSON.parse(await fs.read("/p/package.json")).dependencies).toEqual({
			wren: "^0.0.51",
			other: "1.0.0",
		});
		expect(
			JSON.parse(await fs.read("/p/packages/b/package.json")).devDependencies,
		).toEqual({ wren: "0.0.51" });
	});
});
