import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import { MemoryStorage } from "../storage/testing";
import { type Cascade, type CascadeStep, Cascades } from "./cascade";
import { CascadeRoutes } from "./cascade-routes";
import { readGraph, type ShipProject } from "./graph";
import { planShip } from "./plan";
import { ShipRecovery } from "./recovery";
import { ShipReviews } from "./reviews";
import { FakeProject, servedProjects, until } from "./testing";

describe("ShipRecovery", () => {
	it("recovers a publication npm has but history missed, without publishing it again", async () => {
		const setup = await stoppedShip();
		(setup.stopped.steps[0] as CascadeStep).status = "failed";
		(setup.stopped.steps[0] as CascadeStep).ship = "interrupted";
		const plan = await setup.recovery.plan(setup.graph, setup.stopped);
		expect(plan.recovery?.inputs).toEqual([
			{
				project: "webappwiz",
				pins: [
					{ name: "@webappwiz/cli", version: "0.0.51" },
					{ name: "webappwiz", version: "0.0.51" },
				],
			},
		]);
		expect(plan.steps.map((step) => step.slug)).toEqual([
			"splates",
			"mdom",
			"vexml",
			"sound2score",
		]);
	});

	it("combines multiple published upstreams and releases still owed after a merged bump", async () => {
		const setup = await stoppedShip();
		setup.publish("mdom");
		setup.pin("mdom", "webappwiz", "0.0.51");
		setup.pin("splates", "webappwiz", "0.0.51");
		const plan = await setup.recovery.plan(setup.graph, setup.stopped);
		expect(plan.steps.map((step) => step.slug)).toEqual([
			"splates",
			"vexml",
			"sound2score",
		]);
		expect(plan.steps[0]).toMatchObject({ action: "ship", takes: [] });
		expect(plan.steps[1]?.takes.map((use) => use.project)).toEqual([
			"webappwiz",
			"mdom",
		]);
		expect(plan.recovery?.inputs.map((use) => use.project)).toEqual([
			"webappwiz",
			"mdom",
		]);
	});

	it("is empty once all publications and pins have caught up, including newer pins", async () => {
		const setup = await stoppedShip();
		setup.publish("splates");
		setup.publish("mdom");
		setup.publish("vexml");
		setup.graph.projects = setup.graph.projects.map((project) => ({
			...project,
			uses: project.uses.map((use) => ({
				...use,
				pins: use.pins.map((pin) => ({ ...pin, version: "99.0.0" })),
			})),
		}));
		expect(
			(await setup.recovery.plan(setup.graph, setup.stopped)).steps,
		).toEqual([]);
	});

	it("keeps a stale workspace pin visible when another manifest is current", async () => {
		const setup = await stoppedShip();
		setup.publish("splates");
		setup.pin("splates", "webappwiz", "0.0.51");
		setup.graph.projects[1]?.uses[0]?.pins.push({
			name: "webappwiz",
			version: "0.0.50",
		});
		const plan = await setup.recovery.plan(setup.graph, setup.stopped);
		expect(plan.steps[0]?.takes[0]?.pins).toEqual([
			{ name: "webappwiz", version: "0.0.50" },
		]);
		expect(plan.steps[0]?.to).toBe("0.0.59");
	});

	it("recognizes a later recovery's approved minor release when reopening the original run", async () => {
		const setup = await stoppedShip();
		const original = structuredClone(setup.stopped);
		const recovered: Cascade = {
			...structuredClone(original),
			id: "recovered",
			status: "done",
			started: "2026-10-28T12:00:00Z",
			recovery: { id: original.id, inputs: [] },
			steps: [
				{
					...(original.steps[2] as CascadeStep),
					status: "done",
					to: "1.5.0",
					bump: "minor",
					published: [{ name: "@stringsync/mdom", version: "1.5.0" }],
				},
			],
		};
		setup.registry.versions.add("@stringsync/mdom@1.5.0");
		(setup.graph.projects[2] as ShipProject).version = "1.5.0";
		setup.pin("mdom", "webappwiz", "0.0.51");
		const plan = await setup.recovery.plan(setup.graph, original, [recovered]);
		expect(plan.steps.map((step) => step.slug)).not.toContain("mdom");
		expect(plan.recovery?.inputs).toContainEqual({
			project: "mdom",
			pins: [{ name: "@stringsync/mdom", version: "1.5.0" }],
		});
	});

	it("keeps a never-started standalone release in the recovery plan", async () => {
		const setup = await stoppedShip();
		setup.registry.versions.clear();
		setup.graph.projects = setup.graph.projects
			.slice(0, 1)
			.map((project) => ({ ...project, version: "0.0.50", dependents: [] }));
		setup.stopped.steps = setup.stopped.steps.slice(0, 1);
		const plan = await setup.recovery.plan(setup.graph, setup.stopped);
		expect(plan.recovery?.inputs).toEqual([]);
		expect(plan.steps).toMatchObject([
			{ slug: "webappwiz", action: "ship", to: "0.0.51" },
		]);
	});

	it("blocks downgrading mixed pins and a checkout behind its published version", async () => {
		const setup = await stoppedShip();
		setup.graph.projects[1]?.uses[0]?.pins.push({
			name: "webappwiz",
			version: "0.0.52",
		});
		await expect(
			setup.recovery.plan(setup.graph, setup.stopped),
		).rejects.toThrow("both before and after");
		(setup.graph.projects[0] as ShipProject).version = "0.0.50";
		await expect(
			setup.recovery.plan(setup.graph, setup.stopped),
		).rejects.toThrow("checkout is behind");
	});

	it("blocks partial publications and missing successful publication evidence", async () => {
		const setup = await stoppedShip();
		setup.registry.versions.delete("webappwiz@0.0.51");
		await expect(
			setup.recovery.plan(setup.graph, setup.stopped),
		).rejects.toThrow("reconcile the unfinished publication");
		setup.registry.versions.clear();
		(setup.stopped.steps[0] as CascadeStep).status = "done";
		await expect(
			setup.recovery.plan(setup.graph, setup.stopped),
		).rejects.toThrow("reconcile the unfinished publication");
	});

	it("does not turn unreachable npm into an unpublished release", async () => {
		const setup = await stoppedShip();
		setup.registry.failure = new Error("npm offline");
		await expect(
			setup.recovery.plan(setup.graph, setup.stopped),
		).rejects.toThrow("npm offline");
	});

	it("requires exact pins and a stopped run", async () => {
		const setup = await stoppedShip();
		setup.stopped.status = "running";
		await expect(
			setup.recovery.plan(setup.graph, setup.stopped),
		).rejects.toThrow("only a stopped");
		setup.stopped.status = "stopped";
		setup.pin("splates", "webappwiz", "^0.0.50");
		await expect(
			setup.recovery.plan(setup.graph, setup.stopped),
		).rejects.toThrow("exact versions");
	});

	it("retains and rechecks published inputs when recovery itself stops", async () => {
		const setup = await stoppedShip();
		const plan = await setup.recovery.plan(setup.graph, setup.stopped);
		setup.stopped.recovery = plan.recovery;
		setup.stopped.steps = setup.stopped.steps.slice(1);
		expect(
			(await setup.recovery.plan(setup.graph, setup.stopped)).recovery?.inputs,
		).toEqual(plan.recovery?.inputs);
		setup.registry.versions.clear();
		await expect(
			setup.recovery.plan(setup.graph, setup.stopped),
		).rejects.toThrow("no longer confirms");
	});

	it("reviews and approves a new run, uses confirmed inputs, and refuses stale or repeated approval", async () => {
		const setup = await stoppedShip();
		const storage = new MemoryStorage();
		const projects = new Map(
			setup.sources.map((source) => [
				source.slug,
				new FakeProject(source.root),
			]),
		);
		const seen: string[] = [];
		const reviews = new ShipReviews({
			storage,
			log: new MemoryLogger(),
			plan: async (slug, bump) => planShip(setup.graph, slug, bump),
			recover: async () => setup.recovery.plan(setup.graph, setup.stopped),
			snapshot: async () => "unchanged",
			review: async (step) => {
				seen.push(step.slug);
				return {
					status: "done",
					proposed: "minor",
					reasons: "Adapter repairs",
				};
			},
		});
		const cascades = new Cascades({
			storage,
			fs: setup.fs,
			log: new MemoryLogger(),
			reviews,
			plan: async (slug, bump) => planShip(setup.graph, slug, bump),
			reach: async (slug) => projects.get(slug) as FakeProject,
			timer: new FakeTimer(),
		});
		const routes = new CascadeRoutes(cascades, async () => "webappwiz");
		const draw = async () =>
			(
				await routes.plan(
					new Request("http://localhost/api/ship/plan?recovery=stopped"),
				)
			).json();
		await until(
			async () =>
				!(await draw()).steps.some(
					(step: { review?: { status: string } }) =>
						step.review?.status === "pending",
				),
		);
		const plan = await draw();
		expect(seen).toEqual(["splates", "mdom", "vexml", "sound2score"]);
		await expect(reviews.approve("webappwiz", plan.id)).rejects.toMatchObject({
			reason: "conflict",
		});
		setup.registry.failure = new Error("npm offline at approval");
		await expect(
			reviews.approve("webappwiz", plan.id, {}, "stopped"),
		).rejects.toThrow("npm offline at approval");
		setup.registry.failure = null;
		setup.pin("mdom", "webappwiz", "0.0.51");
		await expect(
			reviews.approve("webappwiz", plan.id, {}, "stopped"),
		).rejects.toMatchObject({ reason: "conflict" });
		setup.pin("mdom", "webappwiz", "0.0.50");
		const response = await routes.startCascade(
			new Request("http://localhost/api/ship?recovery=stopped", {
				method: "POST",
				body: JSON.stringify({ id: plan.id, choices: { mdom: "major" } }),
			}),
		);
		expect(response.status).toBe(201);
		expect(projects.get("webappwiz")?.starts).toBe(0);
		expect(projects.get("mdom")?.bumps.added[0]?.takes[0]?.pins).toEqual([
			{ name: "webappwiz", version: "0.0.51" },
		]);
		expect(
			(await cascades.current())?.steps.find((step) => step.slug === "mdom")
				?.to,
		).toBe("2.0.0");
		await cascades.abandon();
		await expect(
			reviews.approve("webappwiz", plan.id, {}, "stopped"),
		).rejects.toMatchObject({ reason: "conflict" });
		cascades.dispose();
	});
});

class Publications {
	readonly versions = new Set<string>();
	failure: Error | null = null;
	async published(name: string, version: string): Promise<boolean> {
		if (this.failure !== null) {
			throw this.failure;
		}
		return this.versions.has(`${name}@${version}`);
	}
}

async function stoppedShip() {
	const served = await servedProjects();
	const graph = await readGraph(served.fs, served.sources);
	const plan = planShip(graph, "webappwiz");
	const stopped: Cascade = {
		id: "stopped",
		from: plan.from,
		status: "stopped",
		started: "2026-10-28T10:00:00Z",
		ended: "2026-10-28T11:00:00Z",
		steps: plan.steps.map((step) => ({
			...step,
			status: "abandoned",
			task: null,
			ship: null,
			published: [],
			note: null,
			stages: [],
		})),
	};
	const registry = new Publications();
	const recovery = new ShipRecovery(registry);
	const publish = (slug: string) => {
		const step = stopped.steps.find(
			(step) => step.slug === slug,
		) as CascadeStep;
		const project = graph.projects.find(
			(project) => project.slug === slug,
		) as ShipProject;
		project.version = step.to;
		for (const name of step.publishes) {
			registry.versions.add(`${name}@${step.to}`);
		}
	};
	const pin = (slug: string, upstream: string, version: string) => {
		const project = graph.projects.find(
			(project) => project.slug === slug,
		) as ShipProject;
		for (const use of project.uses.filter((use) => use.project === upstream)) {
			for (const pin of use.pins) {
				pin.version = version;
			}
		}
	};
	publish("webappwiz");
	return { ...served, graph, stopped, registry, recovery, publish, pin };
}
