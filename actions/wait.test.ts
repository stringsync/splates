import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration, sleep } from "@webappwiz/time";
import type { Config } from "../config";
import { Git } from "../git";
import { Shell } from "../shell";
import { bails, repo, testConfig } from "../testing";
import { WorktreeStore } from "../worktree-store";
import { create } from "./create";
import { prune } from "./prune";
import { wait } from "./wait";

// Fast enough that a test spends no real time waiting, slow enough that the
// loop still goes round more than once.
const poll = Duration.ms(5);
const timeout = Duration.secs(5);

describe("wait", () => {
	let d: Awaited<ReturnType<typeof repo>> & {
		config: Config;
		store: WorktreeStore;
		shell: Shell;
	};

	beforeEach(async () => {
		const r = await repo();
		const config = testConfig(r.root);
		const store = new WorktreeStore(
			r.fs,
			r.ps,
			new Git(r.ps, r.fs, r.root),
			config,
			r.arborDir,
		);
		await store.init();
		d = { ...r, config, store, shell: new Shell(r.ps) };
	});

	afterEach(() => d.cleanup());

	it("notices a change made while it is polling", async () => {
		await create(d, "alpha");
		d.log.clear();

		const waiting = wait(d, "alpha", { poll, timeout });
		await sleep(Duration.ms(20)); // at least one round of polling
		await (await d.store.find("alpha")).save({ status: "escalated" });
		await waiting;

		expect(d.out()).toContain("escalated alpha");
	});

	it("keeps waiting through the orphaned moment a discard passes through", async () => {
		await create(d, "alpha");
		// What another agent's graft looks like halfway through: directory gone,
		// record still there.
		await d.fs.rm((await d.store.find("alpha")).path, {
			recursive: true,
			force: true,
		});
		d.log.clear();

		// Long enough that the whole discard lands between two polls, which is the
		// case the confirmation exists for.
		const waiting = wait(d, "alpha", { poll: Duration.ms(500), timeout });
		await prune(d, "alpha");
		await waiting;

		expect(d.out()).toContain("gone");
		expect(d.out()).not.toContain("orphaned alpha");
	});

	it("returns straight away for a task that is already gone", async () => {
		await create(d, "alpha");
		await prune(d, "alpha");
		d.log.clear();

		await wait(d, "alpha", { poll, timeout });

		expect(d.out()).toContain("gone");
	});

	it("stops on an escalation and repeats the reason", async () => {
		await create(d, "alpha");
		await (await d.store.find("alpha")).save({
			status: "escalated",
			escalations: [{ reason: "two designs, no right merge", at: "now" }],
		});
		d.log.clear();

		await wait(d, "alpha", { poll, timeout });

		expect(d.out()).toContain("escalated");
		expect(d.out()).toContain("two designs, no right merge");
	});

	it("stops on a task that fell apart rather than waiting it out", async () => {
		await create(d, "alpha");
		await d.fs.rm((await d.store.find("alpha")).path, {
			recursive: true,
			force: true,
		});
		d.log.clear();

		await wait(d, "alpha", { poll, timeout });

		expect(d.out()).toContain("orphaned");
	});

	it("refuses with timed_out while the task is still working", async () => {
		await create(d, "alpha");
		d.log.clear();

		const bailed = await bails(
			wait(d, "alpha", { poll, timeout: Duration.ms(20) }),
		);

		expect(bailed.reason).toBe("timed_out");
		expect(bailed.data).toMatchObject({ task: "alpha", status: "working" });
	});

	it("refuses a task that was never created", async () => {
		expect((await bails(wait(d, "ghost", { poll, timeout }))).reason).toBe(
			"not_found",
		);
	});

	it("carries how it ended as JSON", async () => {
		await create(d, "alpha");
		await prune(d, "alpha");
		d.log.clear();

		await wait(d, "alpha", { poll, timeout, json: true });

		expect(JSON.parse(d.out())).toMatchObject({
			task: "alpha",
			rest: "gone",
			status: "pruned",
		});
	});
});
