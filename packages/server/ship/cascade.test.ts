import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import type { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { Exit } from "../exit";
import { MemoryStorage } from "../storage/testing";
import { Cascades } from "./cascade";
import { readGraph } from "./graph";
import { planShip } from "./plan";
import { FakeProject, servedProjects } from "./testing";

describe("Cascades", () => {
	let fs: FakeFs;
	let storage: MemoryStorage;
	let projects: Map<string, FakeProject>;
	let cascades: Cascades;
	let timer: FakeTimer;

	const project = (slug: string) => projects.get(slug) as FakeProject;
	const statuses = async () =>
		Object.fromEntries(
			((await cascades.current())?.steps ?? []).map((step) => [
				step.slug,
				step.status,
			]),
		);
	/** Ends `slug`'s ship done, its manifests at `version`, and moves on. */
	const shipped = async (slug: string, version: string) => {
		for (const path of await manifestsOf(slug)) {
			const manifest = JSON.parse(await fs.read(path));
			await fs.write(path, JSON.stringify({ ...manifest, version }));
		}
		project(slug).end("done", version);
		await cascades.tick();
	};
	const manifestsOf = async (slug: string) =>
		slug === "webappwiz"
			? [
					"/webappwiz/package.json",
					"/webappwiz/packages/webappwiz/package.json",
					"/webappwiz/packages/cli/package.json",
				]
			: slug === "splates"
				? ["/splates/package.json", "/splates/packages/server/package.json"]
				: [`/${slug}/package.json`];
	const merge = async (slug: string) => {
		project(slug).bumps.states.set(project(slug).bump(), "merged");
		await cascades.tick();
	};

	beforeEach(async () => {
		const served = await servedProjects();
		fs = served.fs;
		storage = new MemoryStorage();
		timer = new FakeTimer();
		projects = new Map(
			served.sources.map((each) => [each.slug, new FakeProject(each.root)]),
		);
		cascades = new Cascades({
			storage,
			fs,
			log: new MemoryLogger(),
			plan: async (slug) => planShip(await readGraph(fs, served.sources), slug),
			reach: async (slug) => {
				const found = projects.get(slug);
				if (found === undefined) {
					throw new Error(`no project ${slug}`);
				}
				return found;
			},
			timer,
			clock: new FakeWallClock(Date.parse("2026-10-27T12:00:00.000Z")),
		});
	});

	it("ships the project it starts from, and holds the rest until it is done", async () => {
		const { cascade, started } = await cascades.start("webappwiz");

		expect(started).toBe(true);
		expect(project("webappwiz").starts).toBe(1);
		expect(cascade.steps.map((step) => [step.slug, step.status])).toEqual([
			["webappwiz", "shipping"],
			["splates", "waiting"],
			["mdom", "waiting"],
			["vexml", "waiting"],
			["sound2score", "waiting"],
		]);
		expect(timer.timeouts).toHaveLength(1);
	});

	it("adds a bump task in each dependent once its ship is done, at the versions it published", async () => {
		await cascades.start("webappwiz");
		await shipped("webappwiz", "0.0.51");

		expect(await statuses()).toMatchObject({
			webappwiz: "done",
			splates: "bumping",
			mdom: "bumping",
			vexml: "waiting",
			sound2score: "waiting",
		});
		expect(project("splates").bumps.added).toEqual([
			{
				from: "webappwiz",
				origin: "/webappwiz",
				takes: [
					{
						project: "webappwiz",
						pins: [
							{ name: "@webappwiz/cli", version: "0.0.51" },
							{ name: "webappwiz", version: "0.0.51" },
						],
					},
				],
			},
		]);
		expect((await cascades.current())?.steps[0]?.published).toContainEqual({
			name: "webappwiz",
			version: "0.0.51",
		});
	});

	it("ships a bumped dependent in turn once its bump merges, one ship at a time", async () => {
		await cascades.start("webappwiz");
		await shipped("webappwiz", "0.0.51");
		await merge("splates");
		await merge("mdom");

		expect(await statuses()).toMatchObject({
			splates: "shipping",
			mdom: "bumping",
		});
		expect(project("mdom").starts).toBe(0);

		await shipped("splates", "0.0.58");

		expect(await statuses()).toMatchObject({
			splates: "done",
			mdom: "shipping",
		});
	});

	it("bumps a project taking from several in one task, once all of them shipped", async () => {
		await cascades.start("webappwiz");
		await shipped("webappwiz", "0.0.51");
		await merge("mdom");
		await shipped("mdom", "1.4.3");

		expect(await statuses()).toMatchObject({ vexml: "bumping" });
		expect(project("vexml").bumps.added).toHaveLength(1);
		expect(
			project("vexml").bumps.added[0]?.takes.flatMap((take) => take.pins),
		).toEqual([
			{ name: "webappwiz", version: "0.0.51" },
			{ name: "@stringsync/mdom", version: "1.4.3" },
		]);
		expect(await statuses()).toMatchObject({ sound2score: "waiting" });
	});

	it("carries a whole cascade to done, the private leaf only taking its bump", async () => {
		await cascades.start("webappwiz");
		await shipped("webappwiz", "0.0.51");
		await merge("splates");
		await shipped("splates", "0.0.58");
		await merge("mdom");
		await shipped("mdom", "1.4.3");
		await merge("vexml");
		await shipped("vexml", "2.0.10");
		await merge("sound2score");

		expect(project("sound2score").starts).toBe(0);
		expect(await cascades.current()).toMatchObject({
			status: "done",
			ended: "2026-10-27T12:00:00.000Z",
		});
		expect(
			project("sound2score").bumps.added[0]?.takes.map((take) => take.project),
		).toEqual(["webappwiz", "splates", "mdom", "vexml"]);
	});

	it("stops at a project whose bump asks the person, holding up those after it", async () => {
		await cascades.start("webappwiz");
		await shipped("webappwiz", "0.0.51");
		project("mdom").bumps.states.set(project("mdom").bump(), "asking");
		await cascades.tick();

		expect(await statuses()).toMatchObject({
			mdom: "asking",
			vexml: "waiting",
		});

		await merge("mdom");

		expect(await statuses()).toMatchObject({ mdom: "shipping" });
	});

	it("stops at a project whose bump was removed, until the person drops it", async () => {
		await cascades.start("webappwiz");
		await shipped("webappwiz", "0.0.51");
		project("mdom").bumps.states.set(project("mdom").bump(), "removed");
		await cascades.tick();

		const stopped = (await cascades.current())?.steps.find(
			(step) => step.slug === "mdom",
		);
		expect(stopped).toMatchObject({
			status: "stopped",
			note: "its bump task 101 was removed without merging",
		});

		await merge("splates");
		await shipped("splates", "0.0.58");
		await cascades.drop("mdom");

		expect(await statuses()).toMatchObject({
			mdom: "dropped",
			vexml: "bumping",
		});
		expect(
			project("vexml").bumps.added[0]?.takes.map((take) => take.project),
		).toEqual(["webappwiz"]);
	});

	it("marks a failed ship, which holds up those after it", async () => {
		await cascades.start("webappwiz");
		project("webappwiz").end("failed");
		await cascades.tick();

		const failed = (await cascades.current())?.steps[0];
		expect(failed).toMatchObject({ status: "failed", note: "npm said no" });
		expect(await statuses()).toMatchObject({ splates: "waiting" });
	});

	it("marks a ship that would not start as failed", async () => {
		project("webappwiz").refuse = "a ship is under way already";
		await cascades.start("webappwiz");

		expect((await cascades.current())?.steps[0]).toMatchObject({
			status: "failed",
			note: "a ship is under way already",
		});
	});

	it("answers with the cascade under way rather than starting another", async () => {
		await cascades.start("webappwiz");
		const again = await cascades.start("mdom");

		expect(again.started).toBe(false);
		expect(again.cascade.from).toBe("webappwiz");
		expect(project("mdom").starts).toBe(0);
	});

	it("refuses to drop a project while it publishes", async () => {
		await cascades.start("webappwiz");

		const refused = await cascades.drop("webappwiz").catch((error) => error);
		expect(refused).toBeInstanceOf(Exit);
		expect((refused as Exit).reason).toBe("conflict");
	});

	it("refuses a plan there is none for", async () => {
		const refused = await cascades.start("sound2score").catch((error) => error);

		expect((refused as Exit).reason).toBe("usage");
		expect(await cascades.current()).toBeNull();
	});

	it("carries on after a restart from what its records kept", async () => {
		await cascades.start("webappwiz");
		cascades.dispose();
		const again = new Cascades({
			storage,
			fs,
			log: new MemoryLogger(),
			plan: async () => {
				throw new Error("not drawn again");
			},
			reach: async (slug) => project(slug),
			timer,
		});
		await again.resume();
		project("webappwiz").end("done", "0.0.51");
		timer.fireTimeouts();
		await again.tick();

		expect(await statuses()).toMatchObject({
			webappwiz: "done",
			mdom: "bumping",
		});
	});
});
