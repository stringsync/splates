import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { MemoryStorage } from "../storage/testing";
import { Cascades } from "./cascade";
import { CascadeRoutes } from "./cascade-routes";
import { readGraph } from "./graph";
import { planShip } from "./plan";
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
