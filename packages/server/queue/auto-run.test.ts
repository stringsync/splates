import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { AutoRunStore } from "./auto-run";

describe("AutoRunStore", () => {
	it("is off until turned on, and off again once removed", async () => {
		const store = new AutoRunStore("/home/.splates/auto-run.json", {
			fs: new FakeFs(),
		});
		expect(await store.on()).toBe(false);

		await store.set(true);
		expect(await store.on()).toBe(true);

		await store.remove();
		expect(await store.on()).toBe(false);
	});
});
