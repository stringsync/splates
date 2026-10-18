import { MemoryLogger } from "webappwiz/log";
import { FakeWallClock } from "webappwiz/time/testing";
import { Scheduler } from "../scheduler";
import { WorkerBudget } from "./budget";
import { WorkerProvisioning } from "./provisioning";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import { Snapshots } from "./snapshot";
import { FakeWorkerProvider } from "./testing";

/** A made worker of a type billed `billing`, with no agent or queue to keep it, and the ids retired. */
export async function idleWorker(billing: "hour" | "second") {
	const wall = new FakeWallClock();
	const retired: string[][] = [];
	const provider = new FakeWorkerProvider([
		{ name: "t", platform: "linux", slots: 4, dollarsPerHour: 0.2, billing },
	]);
	const made = new WorkerProvisioning({
		provider,
		snapshots: await Snapshots.open(provider, { version: "1.0.0", path: null }),
		records: WorkerRecords.memory(),
		registry: new WorkerRegistry(new MemoryLogger()),
		coordinator: () => "https://splates.example.com",
		budget: WorkerBudget.memory(wall),
		log: new MemoryLogger(),
		wall,
		retire: async (ids) => {
			retired.push(ids);
		},
	});
	const worker = (await made.provision()).id;
	const scheduler = new Scheduler(
		{
			workers: () => [
				{
					id: worker,
					kind: "provisioned",
					slots: 4,
					platform: "linux",
					awake: true,
					checkouts: true,
					runs: () => true,
				},
			],
		},
		{ now: () => Date.now() },
	);
	return { wall, retired, made, scheduler, worker };
}
