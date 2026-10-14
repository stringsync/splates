import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { serving } from "./dev-testing";
import { Testing } from "./testing";

describe("dev's service worker", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("serves the worker a phone shows notifications through, from the root", async () => {
		await add(deps, "alpha");

		await serving(deps, async (_snapshot, port) => {
			const response = await fetch(`http://localhost:${port}/worker.js`);

			expect(response.headers.get("content-type")).toContain("text/javascript");
			expect(await response.text()).toContain("notificationclick");
		});
	});
});
