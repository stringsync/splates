import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { join } from "node:path";
import { FakePs } from "core/system/testing";
import { eventually } from "../conversations/testing";
import type { Facts } from "../records";
import type { TicketedLock } from "../server/ticketed-lock";
import { Shell } from "../terminal";
import type { Testing } from "../testing";
import { openBatch } from "./batch-merge-fixture";
import { merge } from "./merge";

setDefaultTimeout(60_000);

describe("merge batches gating", () => {
	let deps: Testing;
	let alpha: string;
	let beta: string;
	let premerge: TicketedLock;
	let offered: (task: string) => Promise<void>;
	beforeEach(async () => {
		({ deps, alpha, beta, premerge, offered } = await openBatch());
	});
	afterEach(async () => {
		await deps.disposeAsync();
	});

	// vet-ignore simple-test-setup: the two merges, their counted shells and the held lock are this case's concurrent inputs.
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
		// Outside the git directory, where biome finds the package.json.
		const gatedIn = alphaPs.getCallEnvs()[0]?.SPLATES_WORKTREE;
		expect(gatedIn).toEndWith("/.gates/alpha-splates-batch");
		expect(gatedIn).not.toContain("/.git/");
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
		expect(deps.line.has("alpha") || deps.line.has("beta")).toBe(false);
		// Beta's wait was asking the file lock when the batch landed, and a
		// lock it gets after that goes straight back, a backed-off poll later.
		const lock = join(deps.splatesHome, "premerge.lock");
		await eventually(async () => !(await deps.fs.exists(lock)), 50);
		expect(await deps.fs.exists(lock)).toBe(false);
	});

	// vet-ignore simple-test-setup: the held lock and the follower that breaks the gate are this case's inputs.
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
		expect(deps.line.has("alpha") || deps.line.has("beta")).toBe(false);
	});
});
