import { describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { movePins, pinsMatch, readGraph } from "./graph";
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

	it("draws a workspace pin on another target's package of the same repository as a use", async () => {
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
			dependencies: { "@stringsync/mdom": "workspace:*" },
		});

		const graph = await readGraph(fs, [
			{
				slug: "@stringsync/mdom",
				root: "/repo",
				packages: ["@stringsync/mdom"],
				ship: "a",
			},
			{
				slug: "@stringsync/vexml",
				root: "/repo",
				packages: ["@stringsync/vexml"],
				ship: "b",
			},
		]);

		const [mdom, vexml] = graph.projects;
		expect(vexml?.uses).toEqual([
			{
				project: "@stringsync/mdom",
				pins: [{ name: "@stringsync/mdom", version: "1.2.0" }],
			},
		]);
		expect(mdom?.dependents.map((each) => each.project)).toEqual([
			"@stringsync/vexml",
		]);
		expect(mdom?.uses).toEqual([]);
	});

	it("draws overlapping targets from the packages they name and the workspace packages those use", async () => {
		const fs = new FakeFs();
		const json = async (path: string, value: object) => {
			await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
			await fs.write(path, JSON.stringify(value));
		};
		await json("/repo/package.json", {
			private: true,
			workspaces: ["app/packages/*"],
		});
		await json("/repo/app/packages/player/package.json", {
			name: "@app/player",
			version: "2.0.0",
			dependencies: { "@app/core": "workspace:*" },
		});
		await json("/repo/app/packages/core/package.json", {
			name: "@app/core",
			version: "0.0.1",
			private: true,
		});
		await json("/repo/app/packages/web/package.json", {
			name: "@app/web",
			private: true,
			dependencies: { "@app/core": "workspace:*" },
		});

		const graph = await readGraph(fs, [
			{ slug: "player", root: "/repo", packages: ["@app/player"], ship: "a" },
			{ slug: "web", root: "/repo", deploys: ["@app/web"], ship: "b" },
		]);

		const [player, web] = graph.projects;
		expect(player?.version).toBe("2.0.0");
		expect(player?.packages).toEqual(["@app/player"]);
		expect(player?.paths).toEqual([
			"app/packages/player/**",
			"app/packages/core/**",
		]);
		expect(web?.deploy).toBe(true);
		expect(web?.version).toBeNull();
		expect(web?.packages).toEqual([]);
		expect(web?.paths).toEqual(["app/packages/web/**", "app/packages/core/**"]);
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

	it("counts a pin held only as a workspace pin as matching, and a stale one beside it as not", async () => {
		const fs = new FakeFs();
		await fs.mkdir("/p/packages/a", { recursive: true });
		await fs.mkdir("/p/packages/b", { recursive: true });
		await fs.write(
			"/p/package.json",
			JSON.stringify({ workspaces: ["packages/*"] }),
		);
		await fs.write(
			"/p/packages/a/package.json",
			JSON.stringify({ dependencies: { wren: "workspace:*" } }),
		);
		const pins = [{ name: "wren", version: "0.0.51" }];

		expect(await pinsMatch(fs, "/p", pins)).toBe(true);
		expect(
			await pinsMatch(fs, "/p", [{ name: "gone", version: "1.0.0" }]),
		).toBe(false);

		await fs.write(
			"/p/packages/b/package.json",
			JSON.stringify({ dependencies: { wren: "0.0.50" } }),
		);
		expect(await pinsMatch(fs, "/p", pins)).toBe(false);
	});
});
