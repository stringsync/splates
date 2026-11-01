import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { join } from "node:path";
import type { FakePs } from "core/system/testing";
import type { Facts } from "../records";
import { add } from "../tasks";
import { Shell } from "../terminal";
import type { Testing } from "../testing";
import { ObservedLock, openConcurrency } from "./concurrency-fixture";
import { merge } from "./merge";

setDefaultTimeout(30_000);

describe("merge concurrency", () => {
	let deps: Testing;
	let alpha: string;
	let beta: string;
	let alphaStarted: PromiseWithResolvers<void>;
	let alphaRelease: PromiseWithResolvers<void>;
	let betaRelease: PromiseWithResolvers<void>;
	let alphaPs: FakePs;
	let betaPs: FakePs;
	let initialHead: string;
	beforeEach(async () => {
		({
			deps,
			alpha,
			initialHead,
			alphaStarted,
			alphaRelease,
			betaRelease,
			alphaPs,
			betaPs,
		} = await openConcurrency());
	});
	afterEach(async () => {
		await deps.disposeAsync();
	});
	// vet-ignore simple-test-setup: the child branch and failing parent gate define this case; sibling merges use a different base and a passing gate.
	it("keeps a child landing out of its parent's running gate without holding the repository lock", async () => {
		await add(deps, "beta", { base: "task/alpha" });
		beta = (await deps.service.find("beta")).path;
		await deps.commit(beta, "beta.txt", "beta\n", "add beta");
		await deps.finish(beta);
		alphaPs.simulate(async () => {
			alphaStarted.resolve();
			await alphaRelease.promise;
			return 1;
		});
		betaRelease.resolve();
		const waiting = new ObservedLock(deps.premerge);

		const first = merge({ ...deps, shell: new Shell({ ps: alphaPs }) }, alpha);
		first.catch(() => {});
		await alphaStarted.promise;
		const second = merge(
			{ ...deps, premerge: waiting, shell: new Shell({ ps: betaPs }) },
			beta,
		);
		try {
			await waiting.started.promise;
			expect(betaPs.getCalls()).toHaveLength(0);
			expect(
				await deps.fs.exists(join(deps.splatesHome, "premerge.lock")),
			).toBe(true);
			await deps.lock.acquire();
			try {
				expect(await deps.git.head(alpha)).toBe(initialHead);
				expect(await deps.fs.exists(join(alpha, "beta.txt"))).toBe(false);
			} finally {
				await deps.lock.release();
			}
			alphaRelease.resolve();
			await expect(first).toBail("tests_failed");
			await second;
			expect(betaPs.getCalls()).toHaveLength(1);
			expect(
				await deps.fs.exists(join(deps.splatesHome, "premerge.lock")),
			).toBe(false);
			expect(await deps.fs.read(join(alpha, "beta.txt"))).toBe("beta\n");
			expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		} finally {
			alphaRelease.resolve();
			await Promise.allSettled([first, second]);
		}
	});

	it("charges a rebase conflict after the base moves, with no charge for the movement", async () => {
		alphaPs.simulate(async () => {
			await deps.commit(deps.root, "alpha.txt", "trunk version\n", "move base");
			return 0;
		});
		const facts: Partial<Facts["merge"]> = {};
		await expect(
			merge({ ...deps, shell: new Shell({ ps: alphaPs }) }, alpha, facts),
		).toBail("conflict");
		expect(facts.retests).toBe(1);
		expect(facts.gateMs).toBeGreaterThan(0);
		expect(facts.durationMs).toBeGreaterThan(facts.gateMs ?? 0);
		expect((await deps.service.find("alpha")).conflictAttempts).toBe(1);
		expect(await deps.git.conflictedPaths(alpha)).toEqual(["alpha.txt"]);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});
});
