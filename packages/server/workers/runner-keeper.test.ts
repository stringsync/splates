import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { WorkerBudget } from "./budget";
import { JobPool } from "./job-pool";
import type { JobSize } from "./job-size";
import { TypeRefused, type WorkerType } from "./provider";
import { WorkerProvisioning } from "./provisioning";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import { RunnerKeeper } from "./runner-keeper";
import { Scheduler } from "./scheduler";
import { Snapshots } from "./snapshot";
import { FakeWorkerProvider } from "./testing";

const JOB: JobSize = { cpus: 4, memory: 8 };

describe("the runner keeper", () => {
	let wall: FakeWallClock;
	let provider: FakeWorkerProvider;
	let records: WorkerRecords;
	let budget: WorkerBudget;
	let scheduler: Scheduler;
	let keeper: RunnerKeeper;
	let pool: JobPool;

	const made = () =>
		provider.getCalls().filter((call) => call.startsWith("create"));
	const job = (id: string) =>
		pool.take({ id, project: "/a", task: null, what: "bun test", size: JOB });

	beforeEach(async () => {
		wall = new FakeWallClock();
		provider = new FakeWorkerProvider(
			[
				{
					name: "c-16",
					platform: "linux",
					slots: 3,
					// Room for three jobs of `JOB`.
					cpus: 12,
					memory: 24,
					dollarsPerHour: 0.5,
					billing: "second",
				},
			],
			wall,
		);
		records = WorkerRecords.memory(wall);
		budget = WorkerBudget.memory(wall);
		const registry = new WorkerRegistry(new MemoryLogger());
		scheduler = new Scheduler(
			{
				workers: () => [{ id: "local", slots: 4, awake: true }],
			},
			wall,
		);
		const provisioning = new WorkerProvisioning({
			provider,
			snapshots: await Snapshots.open(provider, {
				version: "1.0.0",
				document: null,
			}),
			records,
			registry,
			coordinator: () => "https://splates.example.com",
			budget,
			log: new MemoryLogger(),
			wall,
		});
		keeper = new RunnerKeeper({
			registry,
			records,
			local: "local",
			provisioning,
			scheduler,
			log: new MemoryLogger(),
			wall,
		});
		pool = new JobPool(keeper, wall);
		keeper.watch(pool);
	});

	it("makes none while no agent is live and no job waits", async () => {
		await keeper.look();

		expect(made()).toEqual([]);
	});

	it("makes one runner when the first agent starts, and no second for it", async () => {
		await scheduler.take({ id: "c1", project: "/a", task: null, agent: "x" });
		await keeper.look();
		await keeper.look();

		expect(made()).toHaveLength(1);
		expect(keeper.busy()).toEqual(records.all.map((each) => each.id));
	});

	it("makes a runner for a waiting job, then a second only while more wait than room on the way", async () => {
		void pool.take({
			id: "j1",
			project: "/a",
			task: null,
			what: "x",
			size: JOB,
		});
		await Bun.sleep(0);
		await keeper.look();

		expect(made()).toHaveLength(1);

		void Promise.all([job("j2"), job("j3")]);
		await keeper.look();

		expect(made()).toHaveLength(1);

		void job("j4");
		await keeper.look();

		expect(made()).toHaveLength(2);

		void job("j5");
		void job("j6");
		void job("j7");
		await keeper.look();

		expect(made()).toHaveLength(2);
	});

	it("sends jobs to run here at the budget's hard stop rather than let them wait", async () => {
		await budget.set("day", 0.01);
		await budget.started("old", "c-16", 0.5);
		wall.advance(Duration.hrs(1));

		const place = await job("j1");

		expect(place.runner).toBeNull();
		expect(made()).toEqual([]);
	});

	it("sends jobs to run here when a runner could not be made, and tries again after a minute", async () => {
		provider.create = async () => {
			throw new Error("no capacity");
		};
		const waiting = job("j1");
		await keeper.look();

		expect((await waiting).runner).toBeNull();
		expect(keeper.canMake()).toBe(false);

		wall.advance(Duration.secs(61));

		expect(keeper.canMake()).toBe(true);
	});

	it("makes the next type at once when the provider refuses one, with no backoff", async () => {
		const types: WorkerType[] = [
			{
				name: "cheap",
				platform: "linux",
				slots: 1,
				cpus: 4,
				memory: 8,
				dollarsPerHour: 0.07,
				billing: "second",
			},
			{
				name: "dear",
				platform: "linux",
				slots: 1,
				cpus: 4,
				memory: 8,
				dollarsPerHour: 0.12,
				billing: "second",
			},
		];
		const create = provider.create.bind(provider);
		provider.types = async () => types;
		// Refuses the first it is asked for, which it then leaves out, as a cloud's provider does.
		provider.create = async () => {
			types.shift();
			provider.create = create;
			throw new TypeRefused("cheap", "size not available on this account");
		};
		void job("j1");
		await Bun.sleep(0);
		await keeper.look();

		expect(made()).toEqual([expect.stringMatching(/^create dear-\w+ dear /)]);
		expect(keeper.canMake()).toBe(true);
	});
});
