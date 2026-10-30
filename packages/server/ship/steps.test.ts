import { describe, expect, it } from "bun:test";
import { ensure } from "webappwiz/assert";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { MemoryStorage } from "../storage/testing";
import { CascadeRoutes } from "./cascade-routes";
import { FakeStepProjects } from "./fake-step-projects";
import type { ShipSelection } from "./selection";
import { ShipSteps } from "./steps";
import { until } from "./testing";

describe("ship steps", () => {
	it("hands a failed mechanical adopt to an agent and publishes after adoption", async () => {
		const external = new FakeStepProjects();
		external.failAdopt = true;
		const ships = runner(external);
		await ships.start(selection);
		await ships.settled();
		expect((await ships.current())?.status).toBe("stopped");
		external.failAdopt = false;
		await ships.handToAgent();
		await ships.settled();
		const current = await ships.current();
		expect(current?.status).toBe("done");
		expect(
			current?.steps.find((step) => step.slug === "downstream"),
		).toMatchObject({
			adopt: "agent",
			adoptFailure: expect.stringContaining("merge gate failed"),
		});
	});

	it("ships a project without updating its dependencies", async () => {
		const external = new FakeStepProjects();
		const ships = runner(external);
		await ships.start({
			projects: [{ slug: "downstream", bump: "minor", deps: false }],
		});
		await ships.settled();
		expect(external.calls).toEqual([
			"publish downstream minor",
			"live downstream@2.1.0",
		]);
		expect(await ships.current()).toMatchObject({
			status: "done",
			steps: [
				{
					slug: "downstream",
					takes: [],
					stages: [
						{ key: "upstream", state: "skipped" },
						{ key: "adopt", state: "skipped" },
						{ key: "publish", state: "done" },
						{ key: "live", state: "done" },
					],
				},
			],
		});
	});

	it("updates a project's dependencies to what is published, without shipping it", async () => {
		const external = new FakeStepProjects();
		const stale = ensure.defined(external.graph.projects[1]?.uses[0]?.pins[0]);
		stale.version = "0.9.0";
		const ships = runner(external);
		await ships.start({
			projects: [{ slug: "downstream", bump: "patch", ship: false }],
		});
		await ships.settled();
		expect(external.calls).toEqual(["adopt downstream upstream@1.0.0"]);
		expect(await ships.current()).toMatchObject({
			status: "done",
			steps: [
				{
					slug: "downstream",
					action: "bump",
					status: "done",
					stages: [
						{ key: "upstream", state: "skipped" },
						{ key: "adopt", state: "done" },
						{ key: "publish", state: "skipped" },
						{ key: "live", state: "skipped" },
					],
				},
			],
		});
	});

	it("refuses a project that neither updates its dependencies nor ships", async () => {
		const ships = runner(new FakeStepProjects());
		await expect(
			ships.start({
				projects: [
					{ slug: "downstream", bump: "patch", deps: false, ship: false },
				],
			}),
		).rejects.toMatchObject({ reason: "usage" });
	});

	it("runs a root agent adoption before publishing and waits for its merge", async () => {
		const external = new FakeStepProjects();
		const original = external.project.bind(external);
		let finish: () => void = () => {};
		let reached = false;
		const merged = new Promise<void>((resolve) => {
			finish = resolve;
		});
		external.project = async (slug) => ({
			...(await original(slug)),
			adopt: async () => {
				reached = true;
				await merged;
			},
		});
		const ships = runner(external);
		await ships.start({
			projects: [
				{
					slug: "upstream",
					bump: "patch",
					adopt: "agent",
					instructions: "Check root",
				},
			],
		});
		await until(async () => reached);
		expect(external.calls).toEqual([]);
		finish();
		await ships.settled();
		expect((await ships.current())?.status).toBe("done");
		expect(external.calls).toContain("publish upstream patch");
	});

	it("ships in dependency order, retaining choices, stages and history", async () => {
		const external = new FakeStepProjects();
		const ships = runner(external);
		const routes = new CascadeRoutes(ships);
		const response = await routes.start(
			new Request("http://localhost/api/ship/steps", {
				method: "POST",
				body: JSON.stringify(selection),
			}),
		);
		expect(response.status).toBe(201);
		await ships.settled();
		expect(external.calls).toEqual([
			"publish upstream patch",
			"live upstream@1.0.1",
			"live upstream@1.0.1",
			"adopt downstream upstream@1.0.1",
			"publish downstream minor",
			"live downstream@2.1.0",
		]);
		expect(await ships.current()).toMatchObject({
			status: "done",
			steps: [
				{
					slug: "upstream",
					status: "done",
					stages: [
						{ key: "upstream", state: "skipped" },
						{ key: "adopt", state: "skipped" },
						{ key: "publish", state: "done" },
						{ key: "live", state: "done" },
					],
				},
				{
					slug: "downstream",
					status: "done",
					instructions: "Keep the API stable",
					bump: "minor",
					takes: [{ project: "upstream" }],
				},
			],
		});
		expect(await ships.history.summaries()).toMatchObject([{ status: "done" }]);
	});

	it("stops the whole ship on adopt failure and retries only the unfinished stage", async () => {
		const external = new FakeStepProjects();
		external.failAdopt = true;
		const ships = runner(external);
		await ships.start(selection);
		await ships.settled();
		expect(await ships.current()).toMatchObject({
			status: "stopped",
			steps: [
				{ status: "done" },
				{
					status: "failed",
					note: "merge gate failed",
					stages: [
						{ state: "done" },
						{ state: "failed" },
						{ state: "pending" },
						{ state: "pending" },
					],
				},
			],
		});
		expect(external.calls).not.toContain("publish downstream minor");
		await expect(ships.start(selection)).rejects.toMatchObject({
			reason: "conflict",
		});
		external.failAdopt = false;
		external.pins.add("downstream");
		await ships.retry();
		await ships.settled();
		expect(
			external.calls.filter((call) => call.startsWith("publish upstream")),
		).toHaveLength(1);
		expect(
			external.calls.filter((call) => call.startsWith("adopt")),
		).toHaveLength(1);
		expect(await ships.current()).toMatchObject({ status: "done" });
	});

	it("rechecks npm after a failed publish, skipping a version that became published", async () => {
		const external = new FakeStepProjects();
		external.failPublish = true;
		const ships = runner(external);
		await ships.start(selection);
		await ships.settled();
		expect(external.calls).toEqual(["publish upstream patch"]);
		external.failPublish = false;
		external.publications.add("upstream@1.0.1");
		await ships.retry();
		await ships.settled();
		expect(
			external.calls.filter((call) => call === "publish upstream patch"),
		).toHaveLength(1);
		expect(await ships.current()).toMatchObject({
			status: "done",
			steps: [{ stages: [{}, {}, { state: "skipped" }, {}] }, {}],
		});
	});

	it("keeps an unreachable live provider distinct from a successful release", async () => {
		const external = new FakeStepProjects();
		external.failedLive.add("upstream");
		const ships = runner(external);
		await ships.start(selection);
		await ships.settled();
		expect(await ships.current()).toMatchObject({
			status: "stopped",
			steps: [
				{
					note: "provider unreachable",
					stages: [{}, {}, { state: "done" }, { state: "failed" }],
				},
				{ status: "waiting" },
			],
		});
		expect(external.calls).not.toContain("publish downstream minor");
		external.failedLive.clear();
		await ships.retry();
		await ships.settled();
		expect(await ships.current()).toMatchObject({ status: "done" });
	});

	it("resumes an interrupted live wait from the persisted record without republishing", async () => {
		const external = new FakeStepProjects();
		external.lagging = true;
		const storage = new MemoryStorage();
		const fs = new FakeFs();
		let release = () => {};
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = runner(external, storage, fs, () => paused);
		await first.start(selection);
		await until(
			async () => (await first.current())?.steps[0]?.stages[3]?.check !== null,
		);
		const stopped = first.disposeAsync();
		release();
		await stopped;
		expect(await first.current()).toMatchObject({ status: "running" });
		external.lagging = false;
		const restarted = runner(external, storage, fs);
		await restarted.resume();
		await restarted.settled();
		expect(await restarted.current()).toMatchObject({ status: "done" });
		expect(
			external.calls.filter((call) => call === "publish upstream patch"),
		).toHaveLength(1);
	});

	it("Abandon wins an in-flight wait and ends the ship without downstream work", async () => {
		const external = new FakeStepProjects();
		external.lagging = true;
		let release = () => {};
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		const ships = runner(
			external,
			new MemoryStorage(),
			new FakeFs(),
			() => paused,
		);
		await ships.start(selection);
		await until(async () => external.calls.includes("live upstream@1.0.1"));
		await ships.abandon();
		release();
		await ships.settled();
		expect(await ships.current()).toMatchObject({ status: "abandoned" });
		expect(external.calls).not.toContain("publish downstream minor");
		expect(external.publications.has("upstream@1.0.1")).toBe(true);
		await expect(ships.retry()).rejects.toMatchObject({ reason: "conflict" });
	});

	it("times out a lagging release without running downstream", async () => {
		const external = new FakeStepProjects();
		external.lagging = true;
		const clock = new FakeWallClock();
		const ships = new ShipSteps(new MemoryStorage(), new FakeFs(), {
			graph: async () => external.graph,
			project: (slug) => external.project(slug),
			registry: external.registry,
			live: external.live,
			clock,
			pause: async () => {
				clock.advance(Duration.mins(30));
			},
			error: (error) => {
				throw error;
			},
		});
		await ships.start(selection);
		await ships.settled();
		expect(await ships.current()).toMatchObject({
			status: "stopped",
			steps: [
				{ note: "timed out waiting for upstream@1.0.1 to go live" },
				{ status: "waiting" },
			],
		});
	});

	it("refuses concurrent starts across runners sharing the machine record", async () => {
		const external = new FakeStepProjects();
		const storage = new MemoryStorage();
		const first = runner(external, storage);
		const second = runner(external, storage);
		const starts = await Promise.allSettled([
			first.start(selection),
			second.start(selection),
		]);
		expect(starts.map((each) => each.status)).toEqual([
			"fulfilled",
			"rejected",
		]);
		await first.settled();
		expect(
			external.calls.filter((call) => call === "publish upstream patch"),
		).toHaveLength(1);
	});

	it("rejects duplicate or unknown projects before creating a run", async () => {
		const external = new FakeStepProjects();
		const ships = runner(external);
		await expect(
			ships.start({
				projects: [
					ensure.defined(selection.projects[0]),
					ensure.defined(selection.projects[0]),
				],
			}),
		).rejects.toMatchObject({ reason: "usage" });
		await expect(
			ships.start({
				projects: [
					{ ...ensure.defined(selection.projects[0]), slug: "missing" },
				],
			}),
		).rejects.toMatchObject({ reason: "usage" });
		expect(await ships.current()).toBeNull();
		expect(external.calls).toEqual([]);
	});
});

const selection: ShipSelection = {
	projects: [
		{
			slug: "downstream",
			bump: "minor",
			adopt: "mechanical",
			instructions: "Keep the API stable",
		},
		{ slug: "upstream", bump: "patch", adopt: "mechanical", instructions: "" },
	],
};

function runner(
	external: FakeStepProjects,
	storage = new MemoryStorage(),
	fs = new FakeFs(),
	pause?: () => Promise<void>,
): ShipSteps {
	return new ShipSteps(storage, fs, {
		graph: async () => external.graph,
		project: (slug) => external.project(slug),
		registry: external.registry,
		live: external.live,
		clock: new FakeWallClock(Date.parse("2026-10-29T12:00:00Z")),
		pause,
		error: (error) => {
			throw error;
		},
	});
}
