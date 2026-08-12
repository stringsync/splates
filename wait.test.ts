import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration, sleep } from "@webappwiz/time";
import { add } from "./add";
import type { Config } from "./config";
import { Git } from "./git";
import { rm } from "./rm";
import { Shell } from "./shell";
import { bails, repo, testConfig } from "./testing";
import { wait } from "./wait";
import { WorktreeStore } from "./worktree-store";

// Fast enough that a test spends no real time waiting, slow enough that the
// loop still goes round more than once.
const poll = Duration.ms(5);
const timeout = Duration.secs(5);

describe("wait", () => {
	let deps: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		store: WorktreeStore;
		shell: Shell;
	};

	beforeEach(async () => {
		const fixture = await repo();
		const config = testConfig(fixture.root);
		const store = new WorktreeStore(
			fixture.fs,
			fixture.ps,
			new Git(fixture.ps, fixture.fs, fixture.root),
			config,
			fixture.arborDir,
		);
		await store.init();
		deps = { ...fixture, config, store, shell: new Shell(fixture.ps) };
	});

	afterEach(() => deps.cleanup());

	it("notices a change made while it is polling", async () => {
		await add(deps, "alpha");
		deps.log.clear();

		const waiting = wait(deps, "alpha", { poll, timeout });
		await sleep(Duration.ms(20)); // at least one round of polling
		await (await deps.store.find("alpha")).save({ status: "escalated" });
		await waiting;

		expect(deps.out()).toContain("escalated alpha");
	});

	it("keeps waiting through the orphaned moment a discard passes through", async () => {
		await add(deps, "alpha");
		// What another agent's merge looks like halfway through: directory gone,
		// record still there.
		await deps.fs.rm((await deps.store.find("alpha")).path, {
			recursive: true,
			force: true,
		});
		deps.log.clear();

		// Long enough that the whole discard lands between two polls, which is the
		// case the confirmation exists for.
		const waiting = wait(deps, "alpha", { poll: Duration.ms(500), timeout });
		await rm(deps, "alpha");
		await waiting;

		expect(deps.out()).toContain("gone");
		expect(deps.out()).not.toContain("orphaned alpha");
	});

	it("returns straight away for a task that is already gone", async () => {
		await add(deps, "alpha");
		await rm(deps, "alpha");
		deps.log.clear();

		await wait(deps, "alpha", { poll, timeout });

		expect(deps.out()).toContain("gone");
	});

	it("stops on an escalation and repeats the reason", async () => {
		await add(deps, "alpha");
		await (await deps.store.find("alpha")).save({
			status: "escalated",
			escalations: [{ reason: "two designs, no right merge", at: "now" }],
		});
		deps.log.clear();

		await wait(deps, "alpha", { poll, timeout });

		expect(deps.out()).toContain("escalated");
		expect(deps.out()).toContain("two designs, no right merge");
	});

	it("stops on a task that fell apart rather than waiting it out", async () => {
		await add(deps, "alpha");
		await deps.fs.rm((await deps.store.find("alpha")).path, {
			recursive: true,
			force: true,
		});
		deps.log.clear();

		await wait(deps, "alpha", { poll, timeout });

		expect(deps.out()).toContain("orphaned");
	});

	it("refuses with timed_out while the task is still working", async () => {
		await add(deps, "alpha");
		deps.log.clear();

		const bailed = await bails(
			wait(deps, "alpha", { poll, timeout: Duration.ms(20) }),
		);

		expect(bailed.reason).toBe("timed_out");
		expect(bailed.data).toMatchObject({ task: "alpha", status: "working" });
	});

	it("refuses a task that was never created", async () => {
		expect((await bails(wait(deps, "ghost", { poll, timeout }))).reason).toBe(
			"not_found",
		);
	});

	it("carries how it ended as JSON", async () => {
		await add(deps, "alpha");
		await rm(deps, "alpha");
		deps.log.clear();

		await wait(deps, "alpha", { poll, timeout, json: true });

		expect(JSON.parse(deps.out())).toMatchObject({
			task: "alpha",
			rest: "gone",
			status: "removed",
		});
	});
});
