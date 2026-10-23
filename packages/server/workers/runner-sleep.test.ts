import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { eventually } from "../server/testing";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import { RunnerDialer } from "./runner-dialer";
import { FakeReachedProvider } from "./testing";

describe("RunnerDialer with a runner that stops itself", () => {
	let provider: FakeReachedProvider;
	let registry: WorkerRegistry;
	let dialer: RunnerDialer;
	let stopped: boolean;
	let slept: string[];

	beforeEach(async () => {
		provider = new FakeReachedProvider();
		const records = WorkerRecords.memory();
		registry = new WorkerRegistry(new MemoryLogger());
		stopped = false;
		slept = [];
		dialer = new RunnerDialer({
			reach: {
				reach: (id) => provider.reach(id),
				asleep: async () => stopped,
			},
			registry,
			records,
			log: new MemoryLogger(),
			slept: (id) => slept.push(id),
			wait: async () => {},
		});
		await records.set("runner-1", {
			provisioned: {
				type: "small",
				dollarsPerHour: 0.05,
				billing: "second",
				createdAt: 0,
			},
		});
		await provider.create({
			id: "runner-1",
			type: "small",
			snapshot: null,
			recipe: null,
			join: [],
			joinEnv: {},
			boot: [],
		});
	});

	afterEach(() => {
		dialer.dispose();
		registry.dispose();
	});

	it("leaves it asleep until woken, then dials it", async () => {
		dialer.dial("runner-1");
		await eventually(
			async () => registry.worker("runner-1")?.connected === true,
			2000,
		);
		stopped = true;
		provider.links[0]?.drop();
		expect(
			await eventually(async () => dialer.sleeping().length > 0, 2000),
		).toBe(true);
		expect(slept).toEqual(["runner-1"]);
		await Bun.sleep(20);
		expect(provider.reached).toEqual(["runner-1"]);

		stopped = false;
		expect(dialer.wake("runner-1")).toBe(true);
		expect(
			await eventually(async () => provider.reached.length === 2, 2000),
		).toBe(true);
	});
});
