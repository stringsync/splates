import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeWallClock } from "webappwiz/time/testing";
import { eventually } from "../server/testing";
import { WorkerBudget } from "./budget";
import { WorkerProvisioning } from "./provisioning";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import { Scheduler } from "./scheduler";
import { Snapshots } from "./snapshot";
import { FakeReachedProvider } from "./testing";

/** Reached runners whose machines all stand stopped. */
class StoppedProvider extends FakeReachedProvider {
	async asleep(): Promise<boolean> {
		return true;
	}
}

describe("the stopped runners the server keeps", () => {
	let budget: WorkerBudget;
	let made: WorkerProvisioning;
	let retired: string[];
	const scheduler = new Scheduler({ workers: () => [] }, { now: Date.now });

	beforeEach(async () => {
		const wall = new FakeWallClock();
		const provider = new StoppedProvider();
		const records = WorkerRecords.memory(wall);
		// Stopped in the order made, as each is dialed and found asleep.
		for (const [id, cpus] of [
			["small-1", 4],
			["big-1", 16],
			["small-2", 4],
			["small-3", 4],
			["big-2", 16],
			["small-4", 4],
		] as const) {
			await records.set(id, {
				provisioned: {
					type: cpus === 4 ? "small" : "big",
					dollarsPerHour: cpus === 4 ? 0.05 : 0.4,
					billing: "second",
					createdAt: 0,
					cpus,
					memory: cpus * 2,
				},
			});
		}
		budget = WorkerBudget.memory(wall);
		retired = [];
		made = new WorkerProvisioning({
			provider,
			snapshots: await Snapshots.open(provider, {
				version: "1.0.0",
				document: null,
			}),
			records,
			registry: new WorkerRegistry(new MemoryLogger()),
			coordinator: () => null,
			budget,
			log: new MemoryLogger(),
			wall,
			retire: async (ids) => {
				retired.push(...ids);
			},
		});
		await eventually(async () => made.sleeping().length === 6, 2000);
	});

	it("are 4 by default, past which the big ones go first", async () => {
		await made.look(scheduler);

		expect(retired).toEqual(["big-1", "big-2"]);
		made.dispose();
	});

	it("past the count set, go the longest stopped of one size first", async () => {
		await budget.setRunnersKept(1);

		await made.look(scheduler);

		expect(retired).toEqual([
			"big-1",
			"big-2",
			"small-1",
			"small-2",
			"small-3",
		]);
		made.dispose();
	});
});
