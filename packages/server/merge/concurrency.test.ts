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
	beforeEach(async () => {
		({ deps, alpha, alphaStarted, alphaRelease, betaRelease, alphaPs, betaPs } =
			await openConcurrency());
	});
	afterEach(async () => {
		await deps.disposeAsync();
	});
	// vet-ignore simple-test-setup: the two live merges and tested-tip log are this case's concurrent inputs; shared signal setup is in beforeEach.
	it("serializes merge gates and rebases a waiting merge before testing", async () => {
		const tested: string[] = [];
		const facts: Partial<Facts["merge"]> = {};
		const betaStarted = Promise.withResolvers<void>();
		const waiting = new ObservedLock(deps.premerge);
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
		await alphaStarted.promise;
		const second = merge(
			{ ...deps, premerge: waiting, shell: new Shell({ ps: betaPs }) },
			beta,
			facts,
		);
		try {
			await waiting.started.promise;
			expect(betaPs.getCalls()).toHaveLength(0);
			expect(
				await deps.fs.exists(join(deps.splatesHome, "premerge.lock")),
			).toBe(true);
			expect(await deps.fs.exists(deps.lockPath)).toBe(false);
			expect((await deps.service.find("alpha")).status).toBe("working");
			expect((await deps.service.find("beta")).status).toBe("working");
			expect((await deps.service.find("alpha")).gate).toBe("running");
			expect((await deps.service.find("beta")).gate).toBe("queued");
			alphaRelease.resolve();
			await first;
			await betaStarted.promise;
			expect(await deps.fs.read(join(beta, "alpha.txt"))).toBe("alpha\n");
			betaRelease.resolve();
			await second;
			expect(facts.attemptsLeft).toBe(deps.config.mergeRetryCount);
			expect(facts.retests ?? 0).toBe(0);
			expect(tested).toHaveLength(1);
			expect(await deps.git.head(deps.root)).toBe(tested[0] ?? "");
			expect(
				await deps.fs.exists(join(deps.splatesHome, "premerge.lock")),
			).toBe(false);
			expect(await deps.fs.exists(join(deps.root, "alpha.txt"))).toBe(true);
			expect(await deps.fs.exists(join(deps.root, "beta.txt"))).toBe(true);
		} finally {
			alphaRelease.resolve();
			betaRelease.resolve();
			await Promise.allSettled([first, second]);
		}
	});

	// vet-ignore simple-test-setup: this case records the tested tips and pauses the gate to move its base from outside the merge.
	it("retests a moved base before landing without charging an attempt", async () => {
		const tested: string[] = [];
		const facts: Partial<Facts["merge"]> = {};
		alphaPs.simulate(async () => {
			tested.push(await deps.git.head(alpha));
			expect(
				await deps.fs.exists(join(deps.splatesHome, "premerge.lock")),
			).toBe(true);
			expect(await deps.fs.exists(deps.lockPath)).toBe(false);
			alphaStarted.resolve();
			await alphaRelease.promise;
			return 0;
		});
		const running = merge(
			{ ...deps, shell: new Shell({ ps: alphaPs }) },
			alpha,
			facts,
		);
		try {
			await alphaStarted.promise;
			await deps.commit(
				deps.root,
				"late.txt",
				"late\n",
				"move base during gate",
			);
			alphaRelease.resolve();
			await running;
		} finally {
			alphaRelease.resolve();
			await Promise.allSettled([running]);
		}
		expect(facts.attemptsLeft).toBe(deps.config.mergeRetryCount);
		expect(facts.retests).toBe(1);
		expect(tested).toHaveLength(2);
		expect(tested[0]).not.toBe(tested[1] ?? "");
		expect(await deps.git.head(deps.root)).toBe(tested[1] ?? "");
		expect(await deps.fs.read(join(deps.root, "late.txt"))).toBe("late\n");
		expect(await deps.fs.exists(join(deps.splatesHome, "premerge.lock"))).toBe(
			false,
		);
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
});
