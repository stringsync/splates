import { describe, expect, it } from "bun:test";
import { ensure } from "core/assert";
import { FakeFs } from "core/system/testing";
import { Duration } from "core/time";
import { FakeWallClock } from "core/time/testing";
import { MemoryStorage } from "../storage/testing";
import { CascadeRoutes } from "./cascade-routes";
import { FakeStepProjects } from "./fake-step-projects";
import type { ReleaseStep } from "./release-steps";
import type { ShipSelection } from "./selection";
import { ShipSteps } from "./steps";
import { until } from "./testing";

describe("ship steps", () => {
	it("runs a planned version even when the server already sees it published", async () => {
		const external = new FakeStepProjects();
		const target = ensure.defined(external.graph.projects[0]);
		target.commandPlan = {
			schema: 1,
			identity: { kind: "version", from: "1.0.0", to: "1.0.1" },
			resuming: false,
			inputs: [],
			steps: [
				{
					id: "build",
					name: "Build",
					stage: "build",
					packages: [],
					deadlineMs: 1000,
				},
			],
		};
		external.publications.add("upstream@1.0.1");
		const ships = runner(external);
		await ships.start({ projects: [{ slug: "upstream" }] });
		await ships.settled();
		expect(external.calls).toContain("publish upstream patch");
		expect(await ships.current()).toMatchObject({
			status: "done",
			steps: [
				{
					to: "1.0.1",
					stages: [
						{
							key: "publish",
							releaseSteps: [{ id: "build", state: "pending" }],
						},
						{ key: "live" },
					],
				},
			],
		});
	});

	it("trusts a successful command without polling its own release", async () => {
		const external = new FakeStepProjects();
		external.live.check = async () => {
			throw new Error("must not poll command status");
		};
		const ships = runner(external);
		await ships.start({ projects: [{ slug: "upstream" }] });
		await ships.settled();
		expect((await ships.current())?.status).toBe("done");
	});

	it("names a planned target's dependency stages for the upstream selected in the ship", async () => {
		const external = new FakeStepProjects();
		ensure.defined(external.graph.projects[0]).commandPlan = {
			schema: 1,
			identity: { kind: "version", from: "1.0.0", to: "1.0.1" },
			resuming: false,
			inputs: [],
			steps: [],
		};
		ensure.defined(external.graph.projects[1]).commandPlan = {
			schema: 1,
			identity: { kind: "version", from: "2.0.0", to: "2.1.0" },
			resuming: false,
			inputs: [],
			steps: [],
		};
		const ships = runner(external);
		await ships.start(selection);
		await ships.settled();
		expect((await ships.current())?.steps[1]).toMatchObject({
			stages: [
				{ key: "upstream", name: "Wait for upstream live", state: "done" },
				{ key: "adopt", name: "Adopt upstream", state: "skipped" },
				{ key: "publish", state: "done" },
				{ key: "live", state: "skipped" },
			],
		});
	});

	it("retains a page handoff through retry and in history", async () => {
		const external = new FakeStepProjects();
		external.failAdopt = true;
		const ships = runner(external);
		const started = await ships.start(selection);
		await ships.settled();
		await ships.recordAgent(started.id, "downstream");
		external.failAdopt = false;
		await ships.retry();
		await ships.settled();
		expect(
			(await ships.current())?.steps.find((step) => step.slug === "downstream")
				?.sentToAgent,
		).toBe(true);
		expect(
			(await ships.kept(started.id))?.cascade.steps.find(
				(step) => step.slug === "downstream",
			)?.sentToAgent,
		).toBe(true);
		expect(ships.recordAgent("missing", "downstream")).rejects.toThrow();
	});

	it("ships a project whose pins are already current", async () => {
		const external = new FakeStepProjects();
		const ships = runner(external);
		await ships.start({
			projects: [{ slug: "downstream", bump: "minor" }],
		});
		await ships.settled();
		expect(external.calls).toEqual(["publish downstream minor"]);
		expect(await ships.current()).toMatchObject({
			status: "done",
			steps: [
				{
					slug: "downstream",
					takes: [],
					stages: [
						{ key: "publish", state: "done" },
						{ key: "live", state: "skipped" },
					],
				},
			],
		});
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
				return true;
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

	it("starts a task for an adopt request of the ship command and answers it once it merges", async () => {
		const external = new FakeStepProjects();
		const answers: boolean[] = [];
		asksToAdopt(external, answers);
		const ships = runner(external);
		await ships.start(selection);
		await ships.settled();
		expect(external.calls).toContain(
			"task downstream Adopt upstream@1.0.1 for this ship.",
		);
		expect(answers).toEqual([true]);
		expect((await ships.current())?.status).toBe("done");
	});

	it("ships in dependency order, retaining choices, stages and history", async () => {
		const external = new FakeStepProjects();
		const ships = runner(external);
		const routes = new CascadeRoutes(ships);
		const response = await routes.start(
			new Request("http://localhost/api/legacy-ship/steps", {
				method: "POST",
				body: JSON.stringify(selection),
			}),
		);
		expect(response.status).toBe(201);
		await ships.settled();
		expect(external.calls).toEqual([
			"publish upstream patch",
			"live upstream@1.0.1",
			"adopt downstream upstream@1.0.1",
			"publish downstream minor",
		]);
		expect(await ships.current()).toMatchObject({
			status: "done",
			steps: [
				{
					slug: "upstream",
					status: "done",
					stages: [
						{ key: "publish", state: "done" },
						{ key: "live", state: "skipped" },
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
						{ state: "skipped" },
						{ state: "failed" },
						{ state: "pending" },
					],
				},
			],
		});
		expect(external.calls).not.toContain("publish downstream minor");
		expect(ships.start(selection)).rejects.toMatchObject({
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

	it("reruns a failed command even if npm now has the version", async () => {
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
		).toHaveLength(2);
		expect(await ships.current()).toMatchObject({
			status: "done",
			steps: [{ stages: [{ key: "publish", state: "done" }, {}] }, {}],
		});
	});

	it("runs the ship command again for a version published whose release tag never reached the remote", async () => {
		const external = new FakeStepProjects();
		external.publications.add("upstream@1.0.1");
		external.untagged.add("upstream");
		const ships = runner(external);
		await ships.start(selection);
		await ships.settled();
		expect(external.calls).toContain("publish upstream patch");
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
					stages: [
						{ key: "publish", state: "done" },
						{ key: "live", state: "skipped" },
					],
				},
				{ status: "failed", note: "provider unreachable" },
			],
		});
		expect(external.calls).not.toContain("publish downstream minor");
		external.failedLive.clear();
		await ships.retry();
		await ships.settled();
		expect(await ships.current()).toMatchObject({ status: "done" });
	});

	it("never calls a legacy live reader when checking upstream npm packages", async () => {
		const external = new FakeStepProjects();
		const ships = runner(external);
		await ships.start(selection);
		await ships.settled();
		expect(external.liveStatus.get("upstream")).toBeUndefined();
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
			async () => (await first.current())?.steps[1]?.stages[0]?.check != null,
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
		expect(ships.retry()).rejects.toMatchObject({ reason: "conflict" });
	});

	it("times out a lagging release without running downstream", async () => {
		const external = new FakeStepProjects();
		external.lagging = true;
		const clock = new FakeWallClock();
		const ships = new ShipSteps(new MemoryStorage(), new FakeFs(), {
			graph: async () => external.graph,
			project: (slug) => external.project(slug),
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
				{ status: "done" },
				{ note: "timed out waiting for upstream@1.0.1 to go live" },
			],
		});
	});

	it("keeps the release steps a ship command reported on its Publish stage, for a publish and a deploy", async () => {
		const external = new FakeStepProjects();
		external.releaseSteps = [
			{
				id: "build",
				name: "Build",
				stage: "build",
				packages: [],
				state: "done",
				started: "2026-10-29T12:00:00.000Z",
				ended: "2026-10-29T12:00:01.000Z",
				deadlineMs: 1000,
				checked: null,
				status: null,
				url: null,
				error: null,
				staged: [],
				log: { from: 0, to: 6 },
			},
		];
		const ships = runner(external);
		await ships.start({
			projects: [
				{ slug: "downstream", bump: "minor" },
				{ slug: "stage", bump: "patch", adopt: "mechanical", instructions: "" },
			],
		});
		await ships.settled();
		expect(
			(await ships.current())?.steps.map(
				(step) =>
					step.stages.find((stage) => stage.key === "publish")?.releaseSteps,
			),
		).toEqual([external.releaseSteps, external.releaseSteps]);
	});

	it("ships a deploy target with no version, checking its deployed commit", async () => {
		const external = new FakeStepProjects();
		const ships = runner(external);
		await ships.start({
			projects: [
				{ slug: "stage", bump: "patch", adopt: "mechanical", instructions: "" },
			],
		});
		await ships.settled();
		expect(await ships.current()).toMatchObject({
			status: "done",
			steps: [{ slug: "stage", to: "abc1234def" }],
		});
		expect(external.calls).toEqual(["publish stage patch"]);
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
		expect(
			ships.start({
				projects: [
					ensure.defined(selection.projects[0]),
					ensure.defined(selection.projects[0]),
				],
			}),
		).rejects.toMatchObject({ reason: "usage" });
		expect(
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

/** Makes the downstream ship's release ask for a task when it is given upstream versions, recording each answer. */
function asksToAdopt(external: FakeStepProjects, answers: boolean[]): void {
	const original = external.project.bind(external);
	external.project = async (slug) => {
		const project = await original(slug);
		let follower: (steps: ReleaseStep[]) => Promise<void> = async () => {};
		return {
			...project,
			shipping: {
				...project.shipping,
				followSteps: (each) => {
					follower = each;
					return { dispose: () => {} };
				},
				answer: async (_started, _question, answer) => {
					answers.push(answer);
				},
				start: async (...args) => {
					const ship = await project.shipping.start(...args);
					// Only a ship given upstream versions has a release that adopts them.
					await follower(
						[args[1]?.inputs?.adopt].flatMap((adopt) =>
							adopt === undefined
								? []
								: [
										{
											...pendingRelease,
											adopt: {
												versions: { upstream: "1.0.1" },
												unmovable: [],
											},
										},
									],
						),
					);
					return ship;
				},
			},
		};
	};
}

const pendingRelease: ReleaseStep = {
	id: "adopt",
	name: "Adopt",
	stage: "preflight",
	packages: [],
	state: "asking",
	started: null,
	ended: null,
	deadlineMs: 1000,
	checked: null,
	status: null,
	url: null,
	error: null,
	staged: [],
	question: { questionId: "q1", question: "Adopt?" },
};

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
		live: external.live,
		clock: new FakeWallClock(Date.parse("2026-10-29T12:00:00Z")),
		pause,
		error: (error) => {
			throw error;
		},
	});
}
