import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import type { Facts } from "../records";
import type { TicketedLock } from "../server/ticketed-lock";
import type { Testing } from "../testing";
import { openBatch } from "./batch-merge-fixture";
import { merge } from "./merge";

setDefaultTimeout(60_000);

describe("merge batches that conflict", () => {
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

	// vet-ignore simple-test-setup: the held lock and the base moving under the waiting merge are this case's inputs.
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

	// vet-ignore simple-test-setup: the held lock and two merges editing one file are this case's inputs.
	it("keeps the place of a merge that conflicts only with the batch ahead, landing it once that batch is refused", async () => {
		await deps.commit(alpha, "mode.txt", "bad", "break mode");
		await deps.commit(alpha, "README.md", "alpha side\n", "alpha edit");
		await deps.commit(beta, "README.md", "beta side\n", "beta edit");
		await deps.finish(alpha);
		await deps.finish(beta);
		const betaFacts: Partial<Facts["merge"]> = {};
		await premerge.acquire();

		const first = merge({ ...deps, premerge }, alpha);
		await offered("alpha");
		const second = merge({ ...deps, premerge }, beta, betaFacts);
		await offered("beta");
		void first.catch(() => {});
		await premerge.release();
		await expect(first).toBail("tests_failed");
		await second;

		expect(betaFacts.batch).toBeUndefined();
		expect(betaFacts.commit).toEqual(expect.any(String));
		expect(await deps.gitCli(deps.root, "show", "main:README.md")).toBe(
			"beta side",
		);
	});
});
