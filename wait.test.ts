import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration, sleep } from "webappwiz/time";
import { add } from "./add";
import { rm } from "./rm";
import { Testing } from "./testing";
import { wait } from "./wait";

/** Long enough that a test only reaches it when waiting is genuinely stuck. */
const PATIENT = { timeout: Duration.secs(5), poll: Duration.ms(5) };

describe("wait", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("returns with the reason once a task escalates while it waits", async () => {
		await add(deps, "alpha");
		deps.log.clear();

		const waiting = wait(deps, "alpha", PATIENT);
		await sleep(Duration.ms(20));
		await (await deps.service.find("alpha")).save({
			status: "escalated",
			escalations: [{ reason: "needs a human", at: new Date().toISOString() }],
		});
		await waiting;

		expect(deps.out()).toContain("escalated");
		expect(deps.out()).toContain("needs a human");
	});

	it("returns once nothing is left of the task", async () => {
		await add(deps, "alpha");
		await rm(deps, "alpha");
		deps.log.clear();

		await wait(deps, "alpha", PATIENT);

		expect(deps.out()).toContain("removed");
		expect(deps.out()).toContain("arbor log");
	});

	it("gives up on a task that keeps working", async () => {
		await add(deps, "alpha");

		await expect(
			wait(deps, "alpha", { timeout: Duration.ms(20), poll: Duration.ms(5) }),
		).toBail("timeout", {
			message: "still working",
			data: { task: "alpha", status: "working" },
		});
	});

	it("refuses a name nothing remembers", async () => {
		await expect(wait(deps, "nope", PATIENT)).toBail("not_found");
	});
});
