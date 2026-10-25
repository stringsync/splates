import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { join } from "node:path";
import { FakePs } from "webappwiz/system/testing";
import type { Facts } from "../records";
import { TicketedLock } from "../server/ticketed-lock";
import { add } from "../tasks";
import { Shell } from "../terminal";
import { Testing } from "../testing";
import { merge } from "./merge";

setDefaultTimeout(60_000);

const CHECK = `import { test, expect } from "bun:test";
test("mode is good", async () => {
  expect((await Bun.file("mode.txt").text()).trim()).toBe("good");
});
`;
const GATE =
	'bun test --timeout 30000 --reporter=junit --reporter-outfile="$SPLATES_TEST_REPORT"';

describe("merge batches", () => {
	let deps: Testing;
	let alpha: string;
	let beta: string;
	/** The premerge lock as the machine serves it, first come, first served, so alpha leads. */
	let premerge: TicketedLock;
	/** Resolves once `task` has offered itself to a batch. */
	let offered: (task: string) => Promise<void>;
	beforeEach(async () => {
		deps = await Testing.open();
		premerge = new TicketedLock(
			deps.premerge,
			join(deps.splatesHome, "premerge.queue"),
			{ fs: deps.fs, ps: deps.ps, log: deps.log, pollMs: 20 },
		);
		await deps.commit(deps.root, "checks.test.ts", CHECK, "add checks");
		await deps.commit(deps.root, "mode.txt", "good", "good mode");
		await add(deps, "alpha");
		alpha = (await deps.service.find("alpha")).path;
		await add(deps, "beta");
		beta = (await deps.service.find("beta")).path;
		deps.config.preMerge = GATE;
		const records = deps.storage.collection("merge-batch");
		offered = async (task) => {
			for (let i = 0; i < 500; i++) {
				if ((await records.read(`offer:${task}`)) !== null) {
					return;
				}
				await Bun.sleep(10);
			}
			throw new Error(`${task} never offered itself`);
		};
	});
	afterEach(async () => {
		await deps.disposeAsync();
	});

	// scry-ignore simple-test-setup: the held lock and the base moving under the waiting merge are this case's inputs.
	it("refuses a waiting merge once the base moves to conflict with it, without the lock released", async () => {
		await deps.commit(alpha, "README.md", "task side\n", "task edit");
		await deps.finish(alpha);
		await premerge.acquire();

		const merging = merge({ ...deps, premerge }, alpha);
		await offered("alpha");
		await deps.commit(deps.root, "README.md", "trunk side\n", "trunk edit");

		await expect(merging).toBail("conflict", { message: "README.md" });
		expect(await deps.fs.exists(deps.premerge.path)).toBe(true);
		await premerge.release();
	});

	// scry-ignore simple-test-setup: the two merges, their counted shells and the held lock are this case's concurrent inputs.
	it("gates the merges queued behind the lock's holder as one batch, landing them all with one gate", async () => {
		await deps.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(beta, "beta.txt", "beta\n", "add beta");
		await deps.finish(alpha);
		await deps.finish(beta);
		const alphaPs = new FakePs();
		const betaPs = new FakePs();
		alphaPs.simulate(async () => 0);
		betaPs.simulate(async () => 0);
		const alphaFacts: Partial<Facts["merge"]> = {};
		const betaFacts: Partial<Facts["merge"]> = {};
		await premerge.acquire();

		const first = merge(
			{ ...deps, premerge, shell: new Shell({ ps: alphaPs }) },
			alpha,
			alphaFacts,
		);
		await offered("alpha");
		const second = merge(
			{ ...deps, premerge, shell: new Shell({ ps: betaPs }) },
			beta,
			betaFacts,
		);
		await offered("beta");
		await premerge.release();
		await Promise.all([first, second]);

		expect(alphaPs.getCalls()).toHaveLength(1);
		expect(betaPs.getCalls()).toHaveLength(0);
		expect(alphaPs.getCallEnvs()[0]?.SPLATES_WORKTREE).toEndWith(
			"/splates-batch",
		);
		expect(alphaFacts.batch).toEqual(["alpha", "beta"]);
		expect(betaFacts.batch).toEqual(["alpha", "beta"]);
		expect(await deps.outcomes.list()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ task: "alpha", batch: ["alpha", "beta"] }),
				expect.objectContaining({ task: "beta", batch: ["alpha", "beta"] }),
			]),
		);
		expect(betaFacts.commit).toEqual(expect.any(String));
		expect(betaFacts.files).toEqual(["beta.txt"]);
		expect(
			await deps.gitCli(deps.root, "log", "--format=%s", "-3", "main"),
		).toBe("add beta\nadd alpha\ngood mode");
		expect(await deps.fs.exists(join(deps.root, "alpha.txt"))).toBe(true);
		expect(await deps.fs.exists(join(deps.root, "beta.txt"))).toBe(true);
		expect((await deps.service.list()).map((each) => each.task)).toEqual([]);
		expect(await deps.storage.collection("merge-batch").list()).toEqual([]);
		expect(await deps.fs.exists(join(deps.splatesHome, "premerge.lock"))).toBe(
			false,
		);
	});

	// scry-ignore simple-test-setup: the held lock and the follower that breaks the gate are this case's inputs.
	it("refuses the follower whose commits the failing tests fail with, and lands the rest without it", async () => {
		await deps.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(beta, "mode.txt", "bad", "break mode");
		await deps.finish(alpha);
		await deps.finish(beta);
		const betaHead = await deps.git.head(beta);
		const alphaFacts: Partial<Facts["merge"]> = {};
		const betaFacts: Partial<Facts["merge"]> = {};
		await premerge.acquire();

		const first = merge({ ...deps, premerge }, alpha, alphaFacts);
		await offered("alpha");
		const second = merge({ ...deps, premerge }, beta, betaFacts);
		await offered("beta");
		// Settled only once the lock goes, so neither is awaited before then.
		void second.catch(() => {});
		await premerge.release();
		await first;
		await expect(second).toBail("tests_failed", {
			message: "gated in one batch with alpha",
		});

		expect(betaFacts).toMatchObject({
			failureAttribution: "task",
			attemptsLeft: deps.config.mergeRetryCount,
			batch: ["alpha", "beta"],
			failedTests: [expect.objectContaining({ name: "mode is good" })],
		});
		expect(alphaFacts.batch).toBeUndefined();
		expect(alphaFacts.commit).toEqual(expect.any(String));
		expect(
			await deps.gitCli(deps.root, "log", "--format=%s", "-2", "main"),
		).toBe("add alpha\ngood mode");
		// Back on its own head: never left on a stack holding alpha's commit.
		expect(await deps.git.head(beta)).toBe(betaHead);
		expect((await deps.service.find("beta")).mergeAttempts).toBe(0);
		expect(await deps.storage.collection("merge-batch").list()).toEqual([]);
	});

	// scry-ignore simple-test-setup: the held lock and the broken base are this case's inputs.
	it("holds every member of a batch free when the base fails the tests alone", async () => {
		await deps.commit(deps.root, "mode.txt", "bad", "break trunk");
		await deps.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		await deps.commit(beta, "beta.txt", "beta\n", "add beta");
		await deps.finish(alpha);
		await deps.finish(beta);
		const before = await deps.git.head(deps.root);
		const alphaFacts: Partial<Facts["merge"]> = {};
		const betaFacts: Partial<Facts["merge"]> = {};
		await premerge.acquire();

		const first = merge({ ...deps, premerge }, alpha, alphaFacts);
		await offered("alpha");
		const second = merge({ ...deps, premerge }, beta, betaFacts);
		await offered("beta");
		void first.catch(() => {});
		void second.catch(() => {});
		await premerge.release();
		await expect(first).toBail("tests_failed");
		await expect(second).toBail("tests_failed", {
			message: "gated in one batch with alpha",
		});

		expect(alphaFacts).toMatchObject({
			failureAttribution: "trunk",
			attemptsLeft: deps.config.mergeRetryCount,
			batch: ["alpha", "beta"],
		});
		expect(betaFacts).toMatchObject({
			failureAttribution: "trunk",
			attemptsLeft: deps.config.mergeRetryCount,
			batch: ["alpha", "beta"],
		});
		expect(await deps.git.head(deps.root)).toBe(before);
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		expect((await deps.service.find("beta")).mergeAttempts).toBe(0);
	});
});
