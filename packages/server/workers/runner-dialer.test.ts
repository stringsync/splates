import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeWallClock } from "webappwiz/time/testing";
import { eventually } from "../server/testing";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import { RunnerDialer } from "./runner-dialer";
import { FakeReachedProvider } from "./testing";

describe("RunnerDialer", () => {
	let provider: FakeReachedProvider;
	let records: WorkerRecords;
	let registry: WorkerRegistry;
	let dialer: RunnerDialer;

	beforeEach(async () => {
		provider = new FakeReachedProvider();
		records = WorkerRecords.memory();
		registry = new WorkerRegistry(new MemoryLogger());
		const wall = new FakeWallClock();
		dialer = new RunnerDialer({
			reach: provider,
			registry,
			records,
			log: new MemoryLogger(),
			wall,
			// Each wait moves the clock past it, and yields to the timers, so
			// the settle after a dropped link takes no real time.
			wait: async (duration) => {
				wall.advance(duration);
				await Bun.sleep(0);
			},
		});
		await records.set("runner-1", {
			provisioned: {
				type: "small",
				dollarsPerHour: 0.05,
				billing: "second",
				createdAt: 0,
			},
		});
	});

	afterEach(() => {
		dialer.dispose();
		registry.dispose();
	});

	it("joins a made runner it dials, as joined and verified", async () => {
		await provider.create({
			id: "runner-1",
			type: "small",
			snapshot: null,
			recipe: null,
			join: [],
			joinEnv: {},
			boot: [],
		});
		dialer.dial("runner-1");
		expect(
			await eventually(
				async () => registry.worker("runner-1")?.connected === true,
				2000,
			),
		).toBe(true);
		expect(registry.worker("runner-1")?.verified).toBe(true);
		expect(records.of("runner-1")?.joinedAt).not.toBeNull();
	});

	it("dials again once the link drops, and the runner joins again", async () => {
		await provider.create({
			id: "runner-1",
			type: "small",
			snapshot: null,
			recipe: null,
			join: [],
			joinEnv: {},
			boot: [],
		});
		dialer.dial("runner-1");
		await eventually(
			async () => registry.worker("runner-1")?.connected === true,
			2000,
		);
		provider.links[0]?.drop();
		expect(
			await eventually(
				async () =>
					provider.reached.length >= 2 &&
					registry.worker("runner-1")?.connected === true,
				2000,
			),
		).toBe(true);
	});

	it("stops dialing a runner whose machine is gone", async () => {
		dialer.dial("runner-1");
		await eventually(async () => provider.reached.length > 0, 2000);
		await Bun.sleep(20);
		expect(provider.reached).toEqual(["runner-1"]);
	});
});
