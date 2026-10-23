import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { WorkerRecords } from "./records";

describe("WorkerRecords", () => {
	it("keeps local settings across restarts and ignores legacy remote registrations", async () => {
		const storage = new MemoryStorage();
		await storage.document("workers.json").write({
			workers: [
				{ id: "local", slots: 7, draining: true },
				{ id: "box", key: "old", slots: 2 },
			],
			joins: [{ hash: "old" }],
			local: false,
		});
		const records = await WorkerRecords.open(storage.document("workers.json"));
		expect(records.all.map((each) => each.id)).toEqual(["local"]);
		expect(records.of("local")).toMatchObject({ slots: 7, draining: true });
		expect(records.localOn).toBe(false);
		await records.turnLocal(true);
		await records.set("local", { draining: false });
		const again = await WorkerRecords.open(storage.document("workers.json"));
		expect(again.localOn).toBe(true);
		expect(again.of("local")).toMatchObject({ slots: 7, draining: false });
	});

	it("keeps whether it is paused across restarts, unpaused at first", async () => {
		const storage = new MemoryStorage();
		const records = await WorkerRecords.open(storage.document("workers.json"));
		expect(records.paused).toBe(false);

		await records.pause(true);
		const again = await WorkerRecords.open(storage.document("workers.json"));
		expect(again.paused).toBe(true);
	});
});
