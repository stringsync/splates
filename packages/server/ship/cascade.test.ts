import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import type { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
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
	let clock: FakeWallClock;

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
		clock = new FakeWallClock(Date.parse("2026-10-27T12:00:00.000Z"));
		projects = new Map(
			served.sources.map((each) => [each.slug, new FakeProject(each.root)]),
		);
		cascades = new Cascades({
			storage,
			fs,
			log: new MemoryLogger(),
			plan: async (slug, bump) =>
				planShip(await readGraph(fs, served.sources), slug, bump),
			reach: async (slug) => {
				const found = projects.get(slug);
				if (found === undefined) {
					throw new Error(`no project ${slug}`);
				}
				return found;
			},
			timer,
			clock,
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
		project("webappwiz").afterBump = "bunx @webappwiz/cli update";
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
						afterBump: "bunx @webappwiz/cli update",
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

	it("stops the whole run once a bump task is removed unmerged, removing the others' open bump tasks", async () => {
		await cascades.start("webappwiz");
		await shipped("webappwiz", "0.0.51");
		const splates = project("splates").bump();
		project("mdom").bumps.states.set(project("mdom").bump(), "removed");
		await cascades.tick();

		const cascade = await cascades.current();
		expect(cascade?.status).toBe("stopped");
		expect(cascade?.steps.find((step) => step.slug === "mdom")).toMatchObject({
			status: "stopped",
			note: "its bump task 101 was removed without merging",
		});
		expect(
			cascade?.steps.find((step) => step.slug === "splates"),
		).toMatchObject({
			status: "abandoned",
			note: `the run stopped at mdom; its bump task ${splates} was removed`,
		});
		expect(project("splates").bumps.removed).toEqual([splates]);
		expect(await statuses()).toMatchObject({
			webappwiz: "done",
			vexml: "abandoned",
		});
	});
	it("stops the whole run at a failed ship, nothing after it starting", async () => {
		await cascades.start("webappwiz");
		project("webappwiz").end("failed");
		await cascades.tick();

		const cascade = await cascades.current();
		expect(cascade?.status).toBe("stopped");
		expect(cascade?.steps[0]).toMatchObject({
			status: "failed",
			note: "npm said no",
		});
		expect(await statuses()).toMatchObject({ splates: "abandoned" });
		expect(project("splates").bumps.added).toHaveLength(0);
	});

	it("marks a ship that would not start as failed", async () => {
		project("webappwiz").refuse = "a ship is under way already";
		await cascades.start("webappwiz");

		expect((await cascades.current())?.steps[0]).toMatchObject({
			status: "failed",
			note: "a ship is under way already",
		});
	});

	it("keeps the starting bump and revises a pending descendant before it ships", async () => {
		await cascades.start("webappwiz", "major");
		expect(project("webappwiz").releaseBumps).toEqual(["major"]);
		expect((await cascades.current())?.steps[0]).toMatchObject({
			bump: "major",
			to: "1.0.0",
		});
		await shipped("webappwiz", "1.0.0");

		const revised = await cascades.revise("mdom", "minor");
		expect(revised.steps.find((step) => step.slug === "mdom")).toMatchObject({
			status: "bumping",
			bump: "minor",
			to: "1.5.0",
		});
		await merge("mdom");

		expect(project("mdom").releaseBumps).toEqual(["minor"]);
		await expect(cascades.revise("mdom", "major")).rejects.toMatchObject({
			reason: "conflict",
		});
	});

	it("stops the cascade when a ship's actual version is not the approved one", async () => {
		await cascades.start("webappwiz");
		await shipped("webappwiz", "0.1.0");

		expect((await cascades.current())?.steps[0]).toMatchObject({
			status: "failed",
			note: "its ship published 0.1.0, not the approved 0.0.51",
		});
		expect(await statuses()).toMatchObject({ mdom: "abandoned" });
	});

	it("answers with the cascade under way rather than starting another", async () => {
		await cascades.start("webappwiz");
		const again = await cascades.start("mdom");

		expect(again.started).toBe(false);
		expect(again.cascade.from).toBe("webappwiz");
		expect(project("mdom").starts).toBe(0);
	});

	it("refuses a plan there is none for", async () => {
		const refused = await cascades.start("sound2score").catch((error) => error);

		expect((refused as Exit).reason).toBe("usage");
		expect(await cascades.current()).toBeNull();
	});

	it("draws the plan it would start, refusing one there is none for", async () => {
		const plan = await cascades.plan("webappwiz");

		expect(plan.steps[0]?.slug).toBe("webappwiz");
		expect(await cascades.current()).toBeNull();
		await expect(cascades.plan("nowhere")).rejects.toBeInstanceOf(Exit);
	});

	it("shows the ship of the project publishing now, and none once it is past it", async () => {
		expect(await cascades.shown()).toEqual({ cascade: null, ship: null });
		await cascades.start("webappwiz");

		const publishing = await cascades.shown();
		expect(publishing.ship?.project).toBe("webappwiz");

		await shipped("webappwiz", "0.0.51");
		const bumping = await cascades.shown();
		expect(bumping.cascade?.steps[0]?.status).toBe("done");
		expect(bumping.ship).toBeNull();
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

	const stagesOf = async (slug: string) =>
		Object.fromEntries(
			(
				(await cascades.current())?.steps.find((step) => step.slug === slug)
					?.stages ?? []
			).map((stage) => [stage.key, stage.state]),
		);

	it("keeps each project's steps, filed in history under its id, its ship logging there", async () => {
		const { cascade } = await cascades.start("webappwiz");

		expect(cascade.id).toBe("2026-10-27T12-00-00-000Z-webappwiz");
		expect(await stagesOf("webappwiz")).toEqual({
			push: "pending",
			remote: "pending",
			login: "pending",
			otp: "pending",
			command: "pending",
			versions: "pending",
		});
		expect(Object.keys(await stagesOf("mdom"))).toEqual([
			"bump",
			"gate",
			"merged",
			"push",
			"login",
			"otp",
			"command",
			"remote",
			"versions",
		]);
		expect(Object.keys(await stagesOf("sound2score"))).toEqual([
			"bump",
			"gate",
			"merged",
		]);
		expect(project("webappwiz").logs).toEqual([
			cascades.history.logOf(cascade.id, "webappwiz"),
		]);

		await shipped("webappwiz", "0.0.51");
		const webappwiz = (await cascades.history.read(cascade.id))?.steps[0];
		expect(
			webappwiz?.stages.find((stage) => stage.key === "versions"),
		).toMatchObject({
			state: "done",
			check: { result: "published 0.0.51, as planned" },
		});
		expect(await cascades.history.summaries()).toMatchObject([
			{ id: cascade.id, from: "webappwiz", status: "running" },
		]);
	});

	it("follows a bump task through its merge gate to its merge", async () => {
		await cascades.start("webappwiz");
		await shipped("webappwiz", "0.0.51");
		expect(await stagesOf("mdom")).toMatchObject({
			bump: "running",
			gate: "pending",
		});

		project("mdom").bumps.states.set(project("mdom").bump(), "gating");
		await cascades.tick();
		expect(await stagesOf("mdom")).toMatchObject({
			bump: "done",
			gate: "checking",
		});

		await merge("mdom");
		expect(await stagesOf("mdom")).toMatchObject({
			bump: "done",
			gate: "done",
			merged: "done",
		});
		expect(await statuses()).toMatchObject({ mdom: "shipping" });
	});

	it("abandons the cascade: what shipped stays, open bump tasks go, nothing more ships", async () => {
		await cascades.start("webappwiz");
		await shipped("webappwiz", "0.0.51");
		project("splates").bumps.states.set(project("splates").bump(), "asking");
		await cascades.tick();

		const abandoned = await cascades.abandon();

		expect(abandoned.status).toBe("abandoned");
		expect(await statuses()).toEqual({
			webappwiz: "done",
			splates: "abandoned",
			mdom: "abandoned",
			vexml: "abandoned",
			sound2score: "abandoned",
		});
		expect(project("splates").bumps.removed).toEqual([101]);
		expect(project("mdom").bumps.removed).toEqual([101]);
		expect(await stagesOf("mdom")).toMatchObject({
			bump: "failed",
			gate: "skipped",
			command: "skipped",
		});
		expect((await cascades.history.read(abandoned.id))?.status).toBe(
			"abandoned",
		);
		await cascades.tick();
		expect(project("mdom").starts).toBe(0);
		await expect(cascades.abandon()).rejects.toMatchObject({
			reason: "conflict",
		});
	});

	it("stops the ship running as the cascade is abandoned", async () => {
		await cascades.start("webappwiz");

		await cascades.abandon();

		expect(project("webappwiz").stops).toBe(1);
		expect(await statuses()).toMatchObject({ webappwiz: "abandoned" });
	});

	it("expects a step to take what it took lately, and shows it hung past three times that", async () => {
		const before = {
			...(await cascades.start("webappwiz")).cascade,
		};
		await cascades.abandon();
		const command = before.steps[0]?.stages.find(
			(stage) => stage.key === "command",
		);
		await cascades.history.file({
			...before,
			id: "2026-10-26T12-00-00-000Z-webappwiz",
			status: "done",
			steps: [
				{
					...(before.steps[0] as (typeof before.steps)[number]),
					stages: [
						{
							...(command as NonNullable<typeof command>),
							state: "done",
							started: "2026-10-26T12:00:00.000Z",
							ended: "2026-10-26T12:02:00.000Z",
						},
					],
				},
			],
		});
		project("webappwiz").stages = [
			{
				...(command as NonNullable<typeof command>),
				state: "running",
				started: "2026-10-27T12:00:00.000Z",
			},
		];
		clock.advance(Duration.mins(1));
		await cascades.start("webappwiz");
		const stage = async () =>
			(await cascades.shown()).cascade?.steps[0]?.stages.find(
				(each) => each.key === "command",
			);

		expect(await stage()).toMatchObject({
			expected: 120_000,
			known: true,
			state: "running",
			deadline: "2026-10-27T12:06:00.000Z",
		});
		expect(
			(await cascades.current())?.steps[0]?.stages.find(
				(each) => each.key === "login",
			),
		).toMatchObject({ known: false, expected: 120_000 });

		clock.advance(Duration.mins(6));
		expect((await stage())?.state).toBe("hung");
	});

	it("gives what a step printed, from its slice of its project's log", async () => {
		const { cascade } = await cascades.start("webappwiz");
		await fs.write(
			cascades.history.logOf(cascade.id, "webappwiz"),
			"signed in\npublished\n",
		);
		const command = cascade.steps[0]?.stages.find(
			(stage) => stage.key === "command",
		);
		project("webappwiz").ship = {
			...(project("webappwiz").ship as NonNullable<FakeProject["ship"]>),
			stages: [
				{
					...(command as NonNullable<typeof command>),
					state: "running",
					started: "2026-10-27T12:00:00.000Z",
					log: { from: 10, to: null },
				},
			],
		};

		expect(await cascades.stageLog(cascade.id, "webappwiz", "command")).toBe(
			"published\n",
		);
		expect(
			await cascades.stageLog(cascade.id, "webappwiz", "login"),
		).toBeNull();
		expect(
			await cascades.stageLog("nowhere", "webappwiz", "command"),
		).toBeNull();
	});

	it("keeps the last 20 cascades in history, the older going with their logs", async () => {
		const { cascade } = await cascades.start("webappwiz");
		const days = Array.from(
			{ length: 20 },
			(_, i) =>
				`2026-09-${String(i + 1).padStart(2, "0")}T12-00-00-000Z-webappwiz`,
		);
		await Promise.all(
			days.map((id) =>
				cascades.history.file({ ...cascade, id, status: "done" }),
			),
		);
		const oldest = cascades.history.logOf(days[0] as string, "webappwiz");
		await fs.mkdir(oldest.slice(0, oldest.lastIndexOf("/")), {
			recursive: true,
		});
		await fs.write(oldest, "old\n");

		await cascades.history.prune();

		const kept = await cascades.history.summaries();
		expect(kept).toHaveLength(20);
		expect(kept[0]?.id).toBe(cascade.id);
		expect(kept.at(-1)?.id).toBe("2026-09-02T12-00-00-000Z-webappwiz");
		expect(
			await fs.exists(
				cascades.history.logOf(
					"2026-09-01T12-00-00-000Z-webappwiz",
					"webappwiz",
				),
			),
		).toBe(false);
	});
});
