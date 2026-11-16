import { describe, expect, it } from "bun:test";
import { readGraph, type ShipProject } from "./graph";
import {
	CHANGED,
	changedProjects,
	dependencyOrder,
	planShip,
	ShipPlanError,
} from "./plan";
import { servedProjects, withChanges } from "./testing";

describe("planShip", () => {
	it("ships wren, then each dependent with dependents of its own, and bumps the leaves", async () => {
		const { fs, sources } = await servedProjects();
		const graph = await readGraph(fs, sources);

		const plan = planShip(graph, "wren");

		expect(
			plan.steps.map((step) => [step.slug, step.action, step.from, step.to]),
		).toEqual([
			["wren", "ship", "0.0.50", "0.0.51"],
			["splates", "ship", "0.0.57", "0.0.58"],
			["mdom", "ship", "1.4.2", "1.4.3"],
			["vexml", "ship", "2.0.9", "2.0.10"],
			["sound2score", "bump", "0.1.0", null],
		]);
		expect(plan.steps[3]?.why).toBe("sound2score pins it");
		expect(plan.steps[4]?.why).toBe("names no ship command");
		expect(plan.steps[4]?.takes.map((use) => use.project)).toEqual([
			"wren",
			"splates",
			"mdom",
			"vexml",
		]);
	});

	it("leaves out the projects pinning nothing shipped", async () => {
		const { fs, sources } = await servedProjects();
		const graph = await readGraph(fs, sources);

		const plan = planShip(graph, "mdom");

		expect(plan.steps.map((step) => [step.slug, step.action])).toEqual([
			["mdom", "ship"],
			["vexml", "ship"],
			["sound2score", "bump"],
		]);
		expect(plan.steps[1]?.takes).toEqual([
			{
				project: "mdom",
				pins: [{ name: "@stringsync/mdom", version: "1.4.2" }],
			},
		]);
	});

	it("leaves out a skipped dependent and what only it carries the release to", async () => {
		const { fs, sources } = await servedProjects();
		const graph = await readGraph(fs, sources);

		const plan = planShip(graph, "mdom", "patch", ["vexml"]);

		expect(plan.steps.map((step) => [step.slug, step.action])).toEqual([
			["mdom", "ship"],
			["sound2score", "bump"],
		]);
		expect(plan.steps[1]?.takes.map((use) => use.project)).toEqual(["mdom"]);
		expect(plan.skipped).toEqual(["vexml"]);
	});

	it("never skips the project shipped", async () => {
		const { fs, sources } = await servedProjects();
		const graph = await readGraph(fs, sources);

		const plan = planShip(graph, "mdom", "patch", ["mdom", "wren"]);

		expect(plan.steps.map((step) => step.slug)).toEqual([
			"mdom",
			"vexml",
			"sound2score",
		]);
		expect(plan.skipped).toBeUndefined();
	});

	it("only bumps a dependent that names no ship command", async () => {
		const { fs, sources } = await servedProjects();
		const graph = await readGraph(
			fs,
			sources.map((each) =>
				each.slug === "vexml" ? { ...each, ship: null } : each,
			),
		);

		const plan = planShip(graph, "mdom");

		expect(
			plan.steps.map((step) => [step.slug, step.action, step.why]),
		).toEqual([
			["mdom", "ship", "the project shipped"],
			["vexml", "bump", "names no ship command"],
			["sound2score", "bump", "names no ship command"],
		]);
		expect(plan.steps[2]?.takes.map((use) => use.project)).toEqual(["mdom"]);
	});

	it("refuses a project that names no ship command or is not registered", async () => {
		const { fs, sources } = await servedProjects();
		const graph = await readGraph(fs, sources);

		const reason = (slug: string) => {
			try {
				planShip(graph, slug);
			} catch (error) {
				return error instanceof ShipPlanError ? error.reason : null;
			}
			return null;
		};
		expect(reason("sound2score")).toBe("usage");
		expect(reason("nowhere")).toBe("not_found");
	});

	it("plans a private project that names a ship command", async () => {
		const { fs, sources } = await servedProjects();
		const graph = await readGraph(
			fs,
			sources.map((each) =>
				each.slug === "sound2score" ? { ...each, ship: "bin/s2s ship" } : each,
			),
		);

		const plan = planShip(graph, "sound2score");

		expect(plan.steps.map((step) => [step.slug, step.action])).toEqual([
			["sound2score", "ship"],
		]);
		expect(plan.steps[0]?.to).not.toBeNull();
	});

	it("plans the starting project's chosen bump and patch releases downstream", async () => {
		const { fs, sources } = await servedProjects();
		const graph = await readGraph(fs, sources);

		const plan = planShip(graph, "wren", "major");

		expect(plan.steps[0]).toMatchObject({ bump: "major", to: "0.0.51" });
		expect(plan.steps[1]).toMatchObject({ bump: "patch", to: "0.0.58" });
	});

	it("ships every changed project, dependencies first, carrying each downstream", async () => {
		const { fs, sources } = await servedProjects();
		const graph = withChanges(await readGraph(fs, sources), {
			wren: 2,
			mdom: 1,
			splates: 0,
		});

		const plan = planShip(graph, CHANGED);

		expect(plan.from).toBe(CHANGED);
		expect(
			plan.steps.map((step) => [
				step.slug,
				step.action,
				step.takes.map((use) => use.project),
			]),
		).toEqual([
			["wren", "ship", []],
			["splates", "ship", ["wren"]],
			["mdom", "ship", ["wren"]],
			["vexml", "ship", ["wren", "mdom"]],
			["sound2score", "bump", ["wren", "splates", "mdom", "vexml"]],
		]);
		expect(plan.steps[0]?.why).toBe("it has 2 unshipped commits since v0.0.50");
		expect(plan.steps[2]?.why).toBe("it has 1 unshipped commit since v1.4.2");
	});

	it("leaves out unchanged projects nothing changed reaches", async () => {
		const { fs, sources } = await servedProjects();
		const graph = withChanges(await readGraph(fs, sources), { mdom: 4 });

		const plan = planShip(graph, CHANGED);

		expect(plan.steps.map((step) => [step.slug, step.action])).toEqual([
			["mdom", "ship"],
			["vexml", "ship"],
			["sound2score", "bump"],
		]);
	});

	it("counts a deploy target with commits since its deploy as changed", async () => {
		const { fs, sources } = await servedProjects();
		const graph = withChanges(
			await readGraph(
				fs,
				sources.map((each) =>
					each.slug === "sound2score" ? { ...each, ship: "ship-it" } : each,
				),
			),
			{ sound2score: 3 },
		);

		expect(changedProjects(graph).map((each) => each.slug)).toEqual([
			"sound2score",
		]);
	});

	it("refuses a ship of changed projects when none changed", async () => {
		const { fs, sources } = await servedProjects();
		const graph = withChanges(await readGraph(fs, sources), { wren: 0 });

		expect(() => planShip(graph, CHANGED)).toThrow(
			"no project has changed since its last release",
		);
	});

	it("orders a target after those its dependencies name, ignoring one not in the graph", () => {
		const project = (slug: string, dependencies: string[]) =>
			({
				slug,
				dependencies,
				uses: [],
				dependents: [],
			}) as unknown as ShipProject;
		const graph = {
			projects: [
				project("prod", ["staging", "gone"]),
				project("app", ["staging"]),
				project("staging", []),
			],
		};

		expect(dependencyOrder(graph).map((each) => each.slug)).toEqual([
			"staging",
			"prod",
			"app",
		]);
	});
});
