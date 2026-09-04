import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { retry } from "./retry";
import { Testing } from "./testing";

describe("retry", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("puts an escalated task back to working with a fresh budget", async () => {
		await add(deps, "alpha");
		const spent = await deps.service.find("alpha");
		await spent.save({
			status: "escalated",
			mergeAttempts: deps.config.mergeRetryCount,
		});

		await retry(deps, "alpha");

		expect((await deps.service.find("alpha")).state).toMatchObject({
			status: "working",
			mergeAttempts: 0,
		});
	});

	it("refuses a task nobody has escalated", async () => {
		await add(deps, "alpha");

		await expect(retry(deps, "alpha")).toBail("usage", {
			message: "not escalated",
		});
		expect((await deps.service.find("alpha")).state?.status).toBe("working");
	});

	it("refuses a name with no task", async () => {
		await expect(retry(deps, "nope")).toBail("not_found");
	});
});
