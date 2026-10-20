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

	beforeEach(async () => {
		const wall = new FakeWallClock();
		records = WorkerRecords.memory(wall);
		reconciler = new ProviderReconciler({
			provider: new FakeWorkerProvider([]),
			records,
			registry: new WorkerRegistry(new MemoryLogger()),
			budget: WorkerBudget.memory(wall),
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
});
