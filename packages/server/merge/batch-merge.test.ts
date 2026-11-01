import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { FakePs } from "core/system/testing";
import type { Facts } from "../records";
import type { TicketedLock } from "../server/ticketed-lock";
import { Shell } from "../terminal";
import type { Testing } from "../testing";
import { openBatch } from "./batch-merge-fixture";
import { merge } from "./merge";

setDefaultTimeout(60_000);

describe("merge batches", () => {
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

	// vet-ignore simple-test-setup: the held lock, the leader that breaks the gate and the follower's counted shell are this case's inputs.
	it("waits again once a batch it stacked on splits, telling that premerge from its own", async () => {
		await deps.commit(alpha, "mode.txt", "bad", "break mode");
		await deps.commit(beta, "beta.txt", "beta\n", "add beta");
		await deps.finish(alpha);
		await deps.finish(beta);
		const betaPs = new FakePs();
		let stepsAtGate: { step: string; dissolved?: true }[] = [];
		betaPs.simulate(async () => {
			const record = await deps.service.find("beta");
			stepsAtGate = (record.mergeSteps?.steps ?? []).map(
				({ step, dissolved }) => ({
					step,
					...(dissolved ? { dissolved } : {}),
				}),
			);
			return 0;
		});
		const betaFacts: Partial<Facts["merge"]> = {};
		await premerge.acquire();

		const first = merge({ ...deps, premerge }, alpha);
		await offered("alpha");
		const second = merge(
			{ ...deps, premerge, shell: new Shell({ ps: betaPs }) },
			beta,
			betaFacts,
		);
		await offered("beta");
		// Queued behind the held lock, so its wait shows before the batch's.
		// vet-ignore matchers-over-test-logic: waits for the place in line, the input the steps below depend on.
		for (let i = 0; i < 500; i++) {
			// vet-ignore matchers-over-test-logic: as above.
			if ((await deps.service.find("beta")).mergePlace !== null) {
				break;
			}
			await Bun.sleep(10);
		}
		void first.catch(() => {});
		await premerge.release();
		await expect(first).toBail("tests_failed");
		await second;

		expect(betaPs.getCalls()).toHaveLength(1);
		expect(stepsAtGate).toEqual([
			{ step: "rebase" },
			{ step: "wait" },
			{ step: "test", dissolved: true },
			{ step: "wait" },
			{ step: "test" },
		]);
		expect(betaFacts.batch).toBeUndefined();
		expect(betaFacts.commit).toEqual(expect.any(String));
	});

	// vet-ignore simple-test-setup: the held lock and the broken base are this case's inputs.
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
