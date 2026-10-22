import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { Offered } from "./offered";

describe("Offered", () => {
	it("reads the file again after a reload, as after an import wrote it", async () => {
		const storage = new MemoryStorage();
		const offered = new Offered(storage.document("offered.json"));
		await offered.remember("fake", []);
		await storage
			.document("offered.json")
			.write({ format: 1, agents: { other: [] } });
		expect(Object.keys(await offered.all())).toEqual(["fake"]);

		await offered.reload();
		expect(Object.keys(await offered.all())).toEqual(["other"]);
	});
});
