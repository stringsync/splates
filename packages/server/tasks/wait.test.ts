import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration, sleep } from "webappwiz/time";
import { ASKED_QUIET } from "../plans";
import { Testing } from "../testing";
import { add } from "./add";
import { remove } from "./remove";
import { wait } from "./wait";

/** Long enough that a test only reaches it when waiting is genuinely stuck. */
const PATIENT = { timeout: Duration.secs(5), poll: Duration.ms(5) };

describe("wait", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("returns with the question once a task goes quiet asking it", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		deps.log.clear();
		const later = () => Date.now() + ASKED_QUIET.ms;

		const waiting = wait(deps, "alpha", { ...PATIENT, now: later });
		await sleep(Duration.ms(20));
		await deps.fs.write(
			`${tree}/SPLATES.md`,
			"# alpha\n\n## Goal\n\nship it\n\n## Blocked\n\n- [ ] 1. Which table?\n",
		);
		await waiting;

		expect(deps.out()).toContain("asks: Which table?");
		expect(deps.out()).toContain("It waits on a person");
	});

	it("keeps waiting while its agent works on with questions open", async () => {
		await add(deps, "alpha");
		const tree = (await deps.service.find("alpha")).path;
		await deps.fs.write(
			`${tree}/SPLATES.md`,
			"# alpha\n\n## Goal\n\nship it\n\n## Blocked\n\n- [ ] 1. Which table?\n",
		);

		await expect(
			wait(deps, "alpha", { timeout: Duration.ms(20), poll: Duration.ms(5) }),
		).toBail("timeout");
	});

	it("returns once nothing is left of the task", async () => {
		await add(deps, "alpha");
		await remove(deps, "alpha");
		deps.log.clear();

		await wait(deps, "alpha", PATIENT);

		expect(deps.out()).toContain("removed");
		expect(deps.out()).toContain("splates log");
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
