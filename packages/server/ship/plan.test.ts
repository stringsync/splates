import { describe, expect, it } from "bun:test";
import { readGraph } from "./graph";
import { nextPatch, planShip, ShipPlanError } from "./plan";
import { servedProjects } from "./testing";

describe("planShip", () => {
	it("ships webappwiz, then each dependent with dependents of its own, and bumps the leaves", async () => {
		const { fs, sources } = await servedProjects();
		const graph = await readGraph(fs, sources);

		const plan = planShip(graph, "webappwiz");

		expect(
			plan.steps.map((step) => [step.slug, step.action, step.from, step.to]),
		).toEqual([
			["webappwiz", "ship", "0.0.50", "0.0.51"],
			["splates", "ship", "0.0.57", "0.0.58"],
			["mdom", "ship", "1.4.2", "1.4.3"],
			["vexml", "ship", "2.0.9", "2.0.10"],
			["sound2score", "bump", "0.1.0", null],
		]);
		expect(plan.steps[3]?.why).toBe("sound2score pins it");
		expect(plan.steps[4]?.why).toBe("private");
		expect(plan.steps[4]?.takes.map((use) => use.project)).toEqual([
			"webappwiz",
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
			["sound2score", "bump", "private"],
		]);
		expect(plan.steps[2]?.takes.map((use) => use.project)).toEqual(["mdom"]);
	});

	it("refuses a project that is private, names no ship command or is not registered", async () => {
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

	it("bumps the patch of a plain version, and gives up on any other", () => {
		expect(nextPatch("0.0.9")).toBe("0.0.10");
		expect(nextPatch("1.0.0-rc.1")).toBeNull();
	});
});
