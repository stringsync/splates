import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { FakePs } from "core/system/testing";
import { PLAN_FILE } from "../plans";
import type { Facts } from "../records";
import { add } from "../tasks";
import { Shell } from "../terminal";
import { LIVE_PID, Testing } from "../testing";
import { merge } from "./merge";

// Every test here drives real git in a repo of its own, dozens of processes
// each: fast alone, but starved past bun's 5s default when the whole suite
// runs in parallel on a busy machine.
setDefaultTimeout(30_000);

/** Above any pid macOS or Linux hands out, so no process has it. */
const DEAD_PID = 99_999_999;

describe.concurrent("merge, logging and checks", () => {
	// vet-ignore simple-test-setup: each case owns a separate repo, as the timeout case beside it does.
	it("holds the machine's premerge lock while the gate runs, and lets it go", async () => {
		await using deps = await Testing.open();
		deps.config.preMerge = `test -d ${deps.premerge.path}`;

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);
		// The gate's `test -d` fails the merge unless the lock is held.
		await merge(deps, worktree);

		expect(await deps.fs.exists(deps.premerge.path)).toBe(false);
	});

	// vet-ignore simple-test-setup: each case owns a separate repo, as the timeout case beside it does.
	it("tells the gate it holds the premerge lock, and the cores it may use", async () => {
		await using deps = await Testing.open();
		deps.config.preMerge =
			'test -n "$SPLATES_PREMERGE" && test "$SPLATES_CORES" -gt 0';

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);
		// The gate's `test`s fail the merge unless both are set.
		await merge(deps, worktree);

		expect(await deps.fs.exists(join(deps.root, "alpha.txt"))).toBe(true);
	});

	// vet-ignore simple-test-setup: each case owns a separate repo, as the timeout case beside it does.
	it("logs its start, and before it that it is queued only when the premerge lock is held", async () => {
		await using deps = await Testing.open();
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);

		await deps.premerge.acquire();
		const facts: Partial<Facts["merge"]> = {};
		const queuedEvent = Promise.withResolvers<void>();
		const watching = deps.journal.watch();
		watching.events.on("changed", () => {
			void deps.journal
				.tail(1)
				.then(([event]) => {
					// vet-ignore matchers-over-test-logic: the watch also hears unrelated writes; only the queued event releases the held lock.
					if (event?.action === "merge queued" && event.task === "alpha") {
						queuedEvent.resolve();
					}
				})
				.catch(queuedEvent.reject);
		});
		const merging = merge(deps, worktree, facts);
		try {
			// Git preparation can outlast the queue delay on a busy machine.
			// Hold the lock until the merge has actually logged its wait.
			await Promise.race([queuedEvent.promise, merging]);
		} finally {
			watching.dispose();
			await deps.premerge.release();
		}
		await merging;

		const [queued, started] = await deps.journal.tail(2);
		expect(queued).toMatchObject({ action: "merge queued", task: "alpha" });
		expect(started).toMatchObject({ action: "merge start", began: queued?.id });
		expect(facts.began).toBe(queued?.id ?? "");
	});

	// vet-ignore simple-test-setup: each case owns a separate repo, as the timeout case beside it does.
	it("logs only its start when the premerge lock is free", async () => {
		await using deps = await Testing.open();
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);

		const facts: Partial<Facts["merge"]> = {};
		await merge(deps, worktree, facts);

		const [started] = await deps.journal.tail(1);
		expect(started).toMatchObject({ action: "merge start", began: null });
		expect(facts.began).toBe(started?.id ?? "");
	});

	// vet-ignore simple-test-setup: each concurrent case owns a separate repo; shared beforeEach state would race other merges.
	it("keeps on the outcome how long the landing merge queued for the premerge lock and ran", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);
		const facts: Partial<Facts["merge"]> = {};
		await merge(deps, worktree, facts);

		const outcome = (await deps.outcomes.list()).find(
			(each) => each.task === "alpha",
		);
		expect(outcome?.merge?.queuedMs).toBe(facts.capacityWaitMs ?? -1);
		expect(outcome?.merge?.ranMs).toBeGreaterThanOrEqual(facts.gateMs ?? -1);
	});

	it("keeps the slow tests of the JUnit report the gate wrote at $SPLATES_TEST_REPORT", async () => {
		await using deps = await Testing.open();
		const report = join(deps.splatesHome, "report.xml");
		await deps.fs.write(
			report,
			'<testsuites><testsuite name="a.test.ts"><testcase name="quick" time="0.01" file="a.test.ts" /><testcase name="crawls" time="26.5" file="a.test.ts" /></testsuite></testsuites>',
		);
		deps.config.preMerge = `cp ${report} "$SPLATES_TEST_REPORT"`;

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);
		await merge(deps, worktree);

		const outcome = (await deps.outcomes.list()).find(
			(each) => each.task === "alpha",
		);
		expect(outcome?.findings).toContainEqual({
			kind: "slow_tests",
			tests: [{ name: "crawls", file: "a.test.ts", seconds: 26.5 }],
		});
	});

	it("logs the phases the gate timed at $SPLATES_GATE_PHASES, with the rest as setup", async () => {
		await using deps = await Testing.open();
		deps.config.preMerge = `echo '{"phase":"biome","ms":5}' >> "$SPLATES_GATE_PHASES"`;

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);
		const facts: Partial<Facts["merge"]> = {};
		await merge(deps, worktree, facts);

		expect(facts.gate).toEqual({
			workers: expect.any(Number),
			load: expect.any(Number),
			deadlineMs: expect.any(Number),
			ms: { biome: 5, setup: expect.any(Number) },
		});
	});

	it("runs postRewrite before preMerge, and fails the gate when it does", async () => {
		await using deps = await Testing.open();

		// Only passes if the hook ran first, in the same tree, before preMerge.
		deps.config.postRewrite = "echo hooked > hook.txt";
		deps.config.preMerge = "grep -q hooked hook.txt";
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");

		await deps.finish(worktree);
		await merge(deps, worktree);
		expect(await deps.gitCli(deps.root, "log", "-1", "--format=%s")).toBe(
			"add alpha",
		);

		deps.config.postRewrite = "echo boom-from-hook; exit 1";
		await add(deps, "beta");
		const beta = (await deps.service.find("beta")).path;
		await deps.commit(beta, "beta.txt", "beta\n", "add beta");

		await deps.finish(beta);
		await expect(merge(deps, beta)).toBail("tests_failed", {
			message: "boom-from-hook",
		});
		expect((await deps.service.find("beta")).state?.mergeAttempts).toBe(0);
	});

	it("refuses to land while a question is open or an answer unchecked", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const found = await deps.service.find("alpha");
		const worktree = found.path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		const plan = `${worktree}/${PLAN_FILE}`;
		await deps.fs.write(plan, "# alpha\n\n## Blocked\n\n- [ ] 1. Keep it?\n");

		await expect(merge(deps, worktree)).toBail("blocked", {
			message: "questions 1 unchecked",
			data: { task: "alpha", blocked: ["1"], steps: [] },
		});

		// Answered but not acted on: the agent checks it off once it has.
		await deps.fs.write(
			plan,
			"# alpha\n\n## Blocked\n\n- [ ] 1. Keep it? → rename it first\n",
		);
		await expect(merge(deps, worktree)).toBail("blocked");
		expect(
			await deps.gitCli(deps.root, "log", "--oneline", "main"),
		).not.toContain("add alpha");

		const read = await deps.fs.read(plan);
		await deps.fs.write(plan, read.replace("- [ ]", "- [x]"));
		await merge(deps, worktree);
		expect(await deps.gitCli(deps.root, "log", "--oneline", "main")).toContain(
			"add alpha",
		);
	});

	it("refuses to land while a step under ## Next is unchecked", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		const plan = `${worktree}/${PLAN_FILE}`;
		await deps.fs.write(
			plan,
			"# alpha\n\n## Next\n\n- [x] add alpha\n- [ ] add beta\n",
		);

		await expect(merge(deps, worktree)).toBail("blocked", {
			message: "1 step unchecked under ## Next",
			data: { task: "alpha", blocked: [], steps: ["add beta"] },
		});

		await deps.fs.write(
			plan,
			"# alpha\n\n## Next\n\n- [x] add alpha\n- [x] add beta\n",
		);
		await merge(deps, worktree);
		expect(await deps.gitCli(deps.root, "log", "--oneline", "main")).toContain(
			"add alpha",
		);
	});
	it("stops once the retry budget is spent", async () => {
		await using deps = await Testing.open();

		deps.config.mergeRetryCount = 2;
		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await worktree.save({ mergeAttempts: 2 });

		await deps.finish(worktree.path);
		await expect(merge(deps, worktree.path)).toBail("budget_exhausted", {
			message: "splates retry alpha",
		});
	});

	it("stops once the conflict budget is spent, with merge attempts left", async () => {
		await using deps = await Testing.open();

		deps.config.mergeConflictCount = 2;
		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await worktree.save({ conflictAttempts: 2 });

		await deps.finish(worktree.path);
		await expect(merge(deps, worktree.path)).toBail("budget_exhausted", {
			message: "2 conflicted rebases",
		});
	});

	it("refuses to land when the lease changed hands during the test run", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await deps.commit(worktree.path, "alpha.txt", "alpha\n", "add alpha");
		const trunkBefore = await deps.gitCli(deps.root, "rev-parse", "main");
		// Another agent takes the tree while the tests are running: the one
		// window merge cannot hold the record across, and the reason it re-reads
		// it before landing.
		const ps = new FakePs();
		ps.simulate(async () => {
			await worktree.save({
				lease: {
					pid: LIVE_PID,
					hostname: deps.ps.hostname,
					heartbeatAt: new Date().toISOString(),
				},
			});
			return 0;
		});

		await deps.finish(worktree.path);
		await expect(
			merge({ ...deps, shell: new Shell({ ps }) }, worktree.path),
		).toBail("lease_lost");
		expect(await deps.gitCli(deps.root, "rev-parse", "main")).toBe(trunkBefore);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("reads a task a dead merge left merging as working", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await worktree.save({
			status: "merging",
			lease: {
				pid: DEAD_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		expect((await deps.service.find("alpha")).status).toBe("working");
	});

	// vet-ignore simple-test-setup: these tests run concurrently, each on deps of its own, so there is no beforeEach to share it
	it("keeps a task working, not merging, while its merge waits on the lock", async () => {
		await using deps = await Testing.open();

		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await deps.commit(worktree.path, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree.path);
		// What an interrupted merge leaves: `merging` on the record, and the
		// lock gone with its process, then taken by another task's merge.
		await worktree.save({ status: "merging" });
		await deps.lock.acquire();
		const waiting = Promise.withResolvers<void>();
		const lock = {
			acquire: () => {
				waiting.resolve();
				return deps.lock.acquire();
			},
			release: () => deps.lock.release(),
			releaseIfOurs: () => deps.lock.releaseIfOurs(),
		};

		const merged = merge({ ...deps, lock }, worktree.path);
		await waiting.promise;
		expect((await deps.service.find("alpha")).state?.status).toBe("working");

		await deps.lock.release();
		await merged;
		expect(await deps.gitCli(deps.root, "log", "--oneline", "main")).toContain(
			"add alpha",
		);
	});
});
