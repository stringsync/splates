import { describe, expect, it } from "bun:test";
import { Scopes, shipSettings } from "./scopes";

describe("Scopes", () => {
	const scopes = new Scopes(
		{
			projects: { core: ["core/**"], wren: ["wren/**", "wren.md"] },
			shared: ["package.json", "bin/**"],
		},
		"mono",
	);

	it("maps a path to its project, shared or none", () => {
		expect(scopes.of("core/packages/a/x.ts")).toEqual({
			kind: "project",
			slug: "core",
		});
		expect(scopes.of("./wren.md")).toEqual({ kind: "project", slug: "wren" });
		expect(scopes.of("bin/mono")).toEqual({ kind: "shared" });
		expect(scopes.of("notes.txt")).toEqual({ kind: "none" });
		expect(scopes.slugs()).toEqual(["core", "wren"]);
	});

	it("makes the repository one project at its root without projects", () => {
		const one = new Scopes({ projects: null, shared: [] }, "mono");

		expect(one.of("any/where.ts")).toEqual({ kind: "project", slug: "mono" });
		expect(one.slugs()).toEqual(["mono"]);
	});

	it("refuses projects that overlap", () => {
		const make = (projects: Record<string, string[]>) => () =>
			new Scopes({ projects, shared: [] }, "mono");

		expect(make({ a: ["core/**"], b: ["core/packages/x/**"] })).toThrow(
			"overlap",
		);
		expect(make({ a: ["core/**"], b: ["**"] })).toThrow("overlap");
		expect(make({ a: ["a/**"], b: ["ab/**"] })).not.toThrow();
	});

	it("refuses globs that leave the repository or projects with no paths", () => {
		const make = (projects: Record<string, string[]>) => () =>
			new Scopes({ projects, shared: [] }, "mono");

		expect(make({ a: ["../x/**"] })).toThrow("inside the repository");
		expect(make({ a: [] })).toThrow("owns no paths");
		expect(make({ "": ["a/**"] })).toThrow("empty");
	});
});

describe("shipSettings", () => {
	const base = { ship: "repo ship", shipStatus: null, afterBump: "repo bump" };

	it("falls back to the repository's settings", () => {
		const projects = { a: ["a/**"], b: { paths: ["b/**"] } };

		expect(shipSettings({ ...base, projects }, "a")).toEqual(base);
		expect(shipSettings({ ...base, projects }, "b")).toEqual(base);
	});

	it("takes a project's own, null included", () => {
		const projects = {
			a: { paths: ["a/**"], ship: "a ship", shipStatus: "a status" },
			b: { paths: ["b/**"], ship: null },
		};

		expect(shipSettings({ ...base, projects }, "a")).toEqual({
			ship: "a ship",
			shipStatus: "a status",
			afterBump: "repo bump",
		});
		expect(shipSettings({ ...base, projects }, "b").ship).toBeNull();
	});

	it("reads paths from either form", () => {
		const scopes = new Scopes(
			{ projects: { a: { paths: ["a/**"] }, b: ["b/**"] }, shared: [] },
			"mono",
		);

		expect(scopes.of("a/x")).toEqual({ kind: "project", slug: "a" });
		expect(scopes.of("b/x")).toEqual({ kind: "project", slug: "b" });
	});
});
