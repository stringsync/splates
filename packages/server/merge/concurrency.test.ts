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
import { add } from "../tasks";
import { Shell } from "../terminal";
import { LIVE_PID, Testing } from "../testing";
import { merge } from "./merge";

setDefaultTimeout(30_000);

describe("merge concurrency", () => {
	let deps: Testing;
	let alpha: string;
	let beta: string;
	let alphaStarted: PromiseWithResolvers<void>;
	let betaStarted: PromiseWithResolvers<void>;
	let alphaRelease: PromiseWithResolvers<void>;
	let betaRelease: PromiseWithResolvers<void>;
	let alphaPs: FakePs;
	let betaPs: FakePs;
	let initialHead: string;
	beforeEach(async () => {
		deps = await Testing.open();
		await add(deps, "alpha");
		alpha = (await deps.service.find("alpha")).path;
		await deps.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(alpha);
		initialHead = await deps.git.head(alpha);
		alphaStarted = Promise.withResolvers<void>();
		betaStarted = Promise.withResolvers<void>();
		alphaRelease = Promise.withResolvers<void>();
		betaRelease = Promise.withResolvers<void>();
		alphaPs = new FakePs();
		betaPs = new FakePs();
		alphaPs.simulate(async () => {
			alphaStarted.resolve();
			await alphaRelease.promise;
			return 0;
		});
		betaPs.simulate(async () => {
			betaStarted.resolve();
			await betaRelease.promise;
			return 0;
		});
	});
	afterEach(async () => {
		await deps.disposeAsync();
	});
	// scry-ignore simple-test-setup: the two live merges and tested-tip log are this case's concurrent inputs; shared signal setup is in beforeEach.
	it("tests merges concurrently and retests on the new base before landing", async () => {
		const tested: string[] = [];
		const facts: Partial<Facts["merge"]> = {};
		betaPs.simulate(async () => {
			tested.push(await deps.git.head(beta));
			betaStarted.resolve();
			await betaRelease.promise;
			return 0;
		});
		await add(deps, "beta");
		beta = (await deps.service.find("beta")).path;
		await deps.commit(beta, "beta.txt", "beta\n", "add beta");
		await deps.finish(beta);

		const first = merge({ ...deps, shell: new Shell({ ps: alphaPs }) }, alpha);
		const second = merge(
			{ ...deps, shell: new Shell({ ps: betaPs }) },
			beta,
			facts,
		);
		try {
			await Promise.all([alphaStarted.promise, betaStarted.promise]);
			expect(await deps.fs.exists(deps.lockPath)).toBe(false);
			expect((await deps.service.find("alpha")).status).toBe("working");
			expect((await deps.service.find("beta")).status).toBe("working");
			expect((await deps.heavy.read()).running).toHaveLength(2);
			alphaRelease.resolve();
			await first;
			betaRelease.resolve();
			await second;
			expect(facts.attemptsLeft).toBe(deps.config.mergeRetryCount);
			expect(facts.retests).toBe(1);
			expect(tested).toHaveLength(2);
			expect(tested[0]).not.toBe(tested[1] ?? "");
			expect(await deps.git.head(deps.root)).toBe(tested[1] ?? "");
			expect(await deps.fs.exists(join(deps.root, "alpha.txt"))).toBe(true);
			expect(await deps.fs.exists(join(deps.root, "beta.txt"))).toBe(true);
		} finally {
			alphaRelease.resolve();
			betaRelease.resolve();
			await Promise.allSettled([first, second]);
		}
	});

	it("refuses a tip changed by the gate without charging an attempt", async () => {
		const base = await deps.git.head(deps.root);
		alphaPs.simulate(async () => {
			await deps.commit(alpha, "late.txt", "late\n", "untested change");
			return 0;
		});
		await expect(
			merge({ ...deps, shell: new Shell({ ps: alphaPs }) }, alpha),
		).toBail("blocked", { message: "tested tip" });
		expect(await deps.git.head(deps.root)).toBe(base);
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});
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

		const first = merge({ ...deps, shell: new Shell({ ps: alphaPs }) }, alpha);
		first.catch(() => {});
		await alphaStarted.promise;
		const second = merge({ ...deps, shell: new Shell({ ps: betaPs }) }, beta);
		try {
			await betaStarted.promise;
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
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(1);
		expect(await deps.git.conflictedPaths(alpha)).toEqual(["alpha.txt"]);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("stops on a lost lease even when the gate fails, preserving the rebased tree", async () => {
		await deps.commit(deps.root, "late.txt", "late\n", "move base");
		alphaPs.simulate(async () => {
			const tree = await deps.service.find("alpha");
			await tree.save({
				lease: {
					pid: LIVE_PID,
					hostname: deps.ps.hostname,
					heartbeatAt: new Date().toISOString(),
				},
			});
			return 1;
		});
		await expect(
			merge({ ...deps, shell: new Shell({ ps: alphaPs }) }, alpha),
		).toBail("lease_lost");
		expect(await deps.git.head(alpha)).not.toBe(initialHead);
		expect(await deps.fs.exists(join(alpha, "late.txt"))).toBe(true);
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});
});
