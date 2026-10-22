import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeWallClock } from "webappwiz/time/testing";
import { WorkerBudget } from "./budget";
import { ProviderReconciler } from "./reconcile";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import { FakeWorkerProvider } from "./testing";

describe("ProviderReconciler", () => {
	let records: WorkerRecords;
	let reconciler: ProviderReconciler;
	let budget: WorkerBudget;
	let reaped: string[];
	let runners: string[];

	beforeEach(async () => {
		const wall = new FakeWallClock();
		records = WorkerRecords.memory(wall);
		budget = WorkerBudget.memory(wall);
		reaped = [];
		runners = [];
		reconciler = new ProviderReconciler({
			direct: {
				reap: async () => reaped,
				names: async () => runners,
			},
			provider: new FakeWorkerProvider([]),
			records,
			registry: new WorkerRegistry(new MemoryLogger()),
			budget,
			log: new MemoryLogger(),
			wall,
		});
		await records.set("made", {
			provisioned: {
				type: "small",
				dollarsPerHour: 0.05,
				billing: "second",
				createdAt: wall.now(),
			},
		});
	});

	it("never forgets a worker whose machine is still being asked for", async () => {
		const forgotten = await reconciler.creating("made", () =>
			reconciler.reconcile(),
		);

		expect(forgotten).toEqual([]);
		expect(records.of("made")).toBeDefined();
	});

	it("forgets it once its machine is not listed after the ask", async () => {
		await reconciler.creating("made", async () => {});

		expect(await reconciler.reconcile()).toEqual(["made"]);
	});

	it("reaps the runners splates run made and stops counting a life with no machine", async () => {
		reaped = ["splates-run-aaaaaa: idle 10m"];
		runners = ["splates-run-alive1"];
		await budget.started("splates-run-alive1", "s-4vcpu-8gb", 0.07);
		await budget.started("splates-run-gone01", "s-4vcpu-8gb", 0.07);
		await budget.started("s-4vcpu-8gb-70cdbc", "s-4vcpu-8gb", 0.07);

		await reconciler.reconcile();

		expect(budget.running()).toEqual(["splates-run-alive1"]);
	});
});
