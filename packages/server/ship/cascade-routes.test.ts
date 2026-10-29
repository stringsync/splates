import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { MemoryStorage } from "../storage/testing";
import { Cascades } from "./cascade";
import { CascadeRoutes } from "./cascade-routes";
import { readGraph } from "./graph";
import { planShip } from "./plan";
import { ShipPlans } from "./plans";
import { FakeProject, servedProjects } from "./testing";

describe("CascadeRoutes", () => {
	let cascades: Cascades;
	let routes: CascadeRoutes;
	let timer: FakeTimer;

	beforeEach(async () => {
		const served = await servedProjects();
		const projects = new Map(
			served.sources.map((each) => [each.slug, new FakeProject(each.root)]),
		);
		timer = new FakeTimer();
		cascades = new Cascades({
			storage: new MemoryStorage(),
			fs: served.fs,
			log: new MemoryLogger(),
			plan: async (slug, bump) =>
				planShip(await readGraph(served.fs, served.sources), slug, bump),
			reach: async (slug) => projects.get(slug) as FakeProject,
			timer,
			clock: new FakeWallClock(Date.parse("2026-10-27T12:00:00.000Z")),
		});
		routes = new CascadeRoutes(cascades, async () => "webappwiz", timer);
	});

	const at = (path: string) => new Request(`http://localhost${path}`);

	it("lists history, shows one cascade with its steps, and refuses one it does not keep", async () => {
		const { cascade } = await cascades.start("webappwiz");

		expect(await (await routes.history()).json()).toMatchObject([
			{ id: cascade.id, status: "running" },
		]);
		const one = await routes.historyEntry(
			at(`/api/ship/history/${cascade.id}`),
		);
		expect(
			((await one.json()) as { cascade: { steps: { stages: unknown[] }[] } })
				.cascade.steps[0]?.stages,
		).toHaveLength(6);
		await expect(
			routes.historyEntry(at("/api/ship/history/nowhere")),
		).rejects.toMatchObject({ reason: "not_found" });
		await expect(
			routes.historyLog(
				at(`/api/ship/history/${cascade.id}/log?project=webappwiz&stage=x`),
			),
		).rejects.toMatchObject({ reason: "usage" });
	});

	it("abandons the cascade under way", async () => {
		await cascades.start("webappwiz");

		const abandoned = await (await routes.abandonCascade()).json();

		expect(abandoned).toMatchObject({ status: "abandoned" });
	});

	// scry-ignore simple-test-setup: this integration alone needs saved plans enabled
	it("requires a saved plan id, applies approved versions and freezes them across restart", async () => {
		const served = await servedProjects();
		const storage = new MemoryStorage();
		const projects = new Map(
			served.sources.map((source) => [
				source.slug,
				new FakeProject(source.root),
			]),
		);
		const plan = async (slug: string, bump: "patch" | "minor" | "major") =>
			planShip(await readGraph(served.fs, served.sources), slug, bump);
		const plans = new ShipPlans({ storage, plan });
		const opts = {
			storage,
			fs: served.fs,
			log: new MemoryLogger(),
			plan,
			plans,
			reach: async (slug: string) => projects.get(slug) as FakeProject,
			timer,
		};
		const runner = new Cascades(opts);
		const reviewedRoutes = new CascadeRoutes(
			runner,
			async () => "webappwiz",
			timer,
		);
		await expect(
			reviewedRoutes.startCascade(
				new Request("http://localhost/api/ship", { method: "POST" }),
			),
		).rejects.toMatchObject({ reason: "conflict" });
		const draft = await runner.plan("webappwiz");
		const response = await reviewedRoutes.startCascade(
			new Request("http://localhost/api/ship", {
				method: "POST",
				body: JSON.stringify({ id: draft.id, choices: { mdom: "major" } }),
			}),
		);
		expect(response.status).toBe(201);
		expect(projects.get("webappwiz")?.starts).toBe(1);
		const restart = new Cascades(opts);
		expect(
			(await restart.current())?.steps.find((step) => step.slug === "mdom"),
		).toMatchObject({
			bump: "major",
			to: "2.0.0",
		});
		await expect(restart.revise("mdom", "patch")).rejects.toMatchObject({
			reason: "conflict",
		});
		const root = projects.get("webappwiz") as FakeProject;
		root.end("done", "0.0.51");
		await restart.tick();
		const mdom = projects.get("mdom") as FakeProject;
		mdom.bumps.states.set(mdom.bump(), "merged");
		await restart.tick();
		// splates ships first; finish it to let mdom publish its approved major.
		(projects.get("splates") as FakeProject).bumps.states.set(101, "merged");
		await restart.tick();
		(projects.get("splates") as FakeProject).end("done", "0.1.0");
		await restart.tick();
		expect(mdom.releaseBumps).toEqual(["major"]);
		runner.dispose();
		restart.dispose();
	});

	it("streams the cascade as the page joins, and again once it changes", async () => {
		const stream = (await routes.cascadeEvents()).body?.getReader();
		const read = async () =>
			new TextDecoder().decode((await stream?.read())?.value);

		expect(await read()).toBe(
			`data: ${JSON.stringify({ cascade: null, ship: null })}\n\n`,
		);
		await cascades.start("webappwiz");
		timer.fireTimeouts();
		expect(await read()).toContain('"from":"webappwiz"');
		timer.fireTimeouts();
		expect(await read()).toBe(": pulse\n\n");
		await stream?.cancel();
	});
});
