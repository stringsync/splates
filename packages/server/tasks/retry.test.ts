import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { add } from "./add";
import { retry } from "./retry";

describe("retry", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("gives a task that spent its merge attempts a fresh budget", async () => {
		await add(deps, "alpha");
		const spent = await deps.service.find("alpha");
		await spent.save({ mergeAttempts: deps.config.mergeRetryCount });

		await retry(deps, "alpha");

		expect((await deps.service.find("alpha")).state).toMatchObject({
			status: "working",
			mergeAttempts: 0,
		});
	});

	it("gives a task that spent its conflicted rebases both budgets back", async () => {
		await add(deps, "alpha");
		const spent = await deps.service.find("alpha");
		await spent.save({
			mergeAttempts: 1,
			conflictAttempts: deps.config.mergeConflictCount,
		});

		await retry(deps, "alpha");

		expect((await deps.service.find("alpha")).state).toMatchObject({
			mergeAttempts: 0,
			conflictAttempts: 0,
		});
	});

	it("hands back the attempts the task had spent before the grant", async () => {
		await add(deps, "alpha");
		const spent = await deps.service.find("alpha");
		await spent.save({ mergeAttempts: deps.config.mergeRetryCount });

		const granted = await retry(deps, "alpha");

		expect(granted.attempts).toBe(deps.config.mergeRetryCount);
	});

	it("refuses a task with merge attempts left", async () => {
		await add(deps, "alpha");

		await expect(retry(deps, "alpha")).toBail("usage", {
			message: "only a task that spent one budget",
		});
		expect((await deps.service.find("alpha")).state?.status).toBe("working");
	});

	it("refuses a name with no task", async () => {
		await expect(retry(deps, "nope")).toBail("not_found");
	});
});
