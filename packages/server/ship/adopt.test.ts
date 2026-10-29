import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import type { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { MemoryStorage } from "../storage/testing";
import { AdoptRoutes } from "./adopt-routes";
import { type AgentNeed, Cascades } from "./cascade";
import { readGraph } from "./graph";
import { planShip } from "./plan";
import { FakeProject, servedProjects } from "./testing";

describe("a cascade the ship agent adopts", () => {
	let fs: FakeFs;
	let projects: Map<string, FakeProject>;
	let cascades: Cascades;

	const project = (slug: string) => projects.get(slug) as FakeProject;
	const status = async (slug: string) =>
		(await cascades.current())?.steps.find((step) => step.slug === slug)
			?.status;
	/** Ends webappwiz's ship done at 0.0.51, so its dependents can begin. */
	const upstreamShipped = async () => {
		for (const path of [
			"/webappwiz/package.json",
			"/webappwiz/packages/webappwiz/package.json",
			"/webappwiz/packages/cli/package.json",
		]) {
			const manifest = JSON.parse(await fs.read(path));
			await fs.write(path, JSON.stringify({ ...manifest, version: "0.0.51" }));
		}
		project("webappwiz").end("done", "0.0.51");
		await cascades.tick();
	};

	beforeEach(async () => {
		const served = await servedProjects();
		fs = served.fs;
		projects = new Map(
			served.sources.map((each) => [each.slug, new FakeProject(each.root)]),
		);
		cascades = new Cascades({
			storage: new MemoryStorage(),
			fs,
			log: new MemoryLogger(),
			plan: async (slug, bump) =>
				planShip(await readGraph(fs, served.sources), slug, bump),
			reach: async (slug) => project(slug),
			timer: new FakeTimer(),
			clock: new FakeWallClock(Date.parse("2026-10-27T12:00:00.000Z")),
		});
		await cascades.startPlan(
			planShip(await readGraph(fs, served.sources), "webappwiz", "patch"),
		);
	});

	it("opens no bump task: it waits for the agent to adopt, land, then ships", async () => {
		expect((await cascades.need()).kind).toBe("wait");
		await upstreamShipped();
		expect(project("splates").bumps.added).toHaveLength(0);
		const need = (await cascades.need()) as Extract<
			AgentNeed,
			{ kind: "adopt" }
		>;
		expect(need).toMatchObject({
			kind: "adopt",
			project: "splates",
			adoption: { takes: [{ project: "webappwiz" }] },
		});
		expect(need.adoption.takes[0]?.pins[0]?.version).toBe("0.0.51");

		await expect(cascades.landed("splates")).rejects.toMatchObject({
			reason: "conflict",
		});
		await cascades.adopt("splates", { task: need.task, path: "/trees/a" });
		expect(await cascades.need()).toMatchObject({
			kind: "land",
			project: "splates",
			path: "/trees/a",
		});
		expect(project("splates").starts).toBe(0);

		await cascades.landed("splates");
		expect(await status("splates")).toBe("shipping");
		expect(project("splates").starts).toBe(1);
	});

	it("stops the whole run when the agent cannot land a dependent", async () => {
		await upstreamShipped();
		await cascades.adopt("splates", { task: "t", path: "/trees/a" });
		await cascades.stopAt("splates", "its gate failed");
		const cascade = await cascades.current();
		expect(cascade?.status).toBe("stopped");
		expect(await cascades.need()).toEqual({ kind: "ended", status: "stopped" });
	});

	it("records a handoff until the agent runs next again", async () => {
		await cascades.handoff(7);
		expect((await cascades.current())?.handoff?.task).toBe(7);
		const routes = new AdoptRoutes(cascades);
		await routes.next(new Request("http://x/api/ship/run/next"));
		expect((await cascades.current())?.handoff).toBeUndefined();
	});
});
