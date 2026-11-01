import type { Lock } from "core/system";
import { FakePs } from "core/system/testing";
import { add } from "../tasks";
import { Testing } from "../testing";

/** A repository with alpha finished, a held gate for each of alpha and beta, and their counted shells' fakes. */
export async function openConcurrency() {
	const deps = await Testing.open();
	await add(deps, "alpha");
	const alpha = (await deps.service.find("alpha")).path;
	await deps.commit(alpha, "alpha.txt", "alpha\n", "add alpha");
	await deps.finish(alpha);
	const initialHead = await deps.git.head(alpha);
	const alphaStarted = Promise.withResolvers<void>();
	const alphaRelease = Promise.withResolvers<void>();
	const betaRelease = Promise.withResolvers<void>();
	const alphaPs = new FakePs();
	const betaPs = new FakePs();
	alphaPs.simulate(async () => {
		alphaStarted.resolve();
		await alphaRelease.promise;
		return 0;
	});
	betaPs.simulate(async () => {
		await betaRelease.promise;
		return 0;
	});
	return {
		deps,
		alpha,
		initialHead,
		alphaStarted,
		alphaRelease,
		betaRelease,
		alphaPs,
		betaPs,
	};
}

/** Signals that a merge reached the real premerge lock, without sleeps. */
export class ObservedLock implements Lock {
	readonly started = Promise.withResolvers<void>();
	constructor(private readonly inner: Lock) {}
	async acquire(): Promise<void> {
		this.started.resolve();
		await this.inner.acquire();
	}
	async release(): Promise<void> {
		await this.inner.release();
	}
	async releaseIfOurs(): Promise<void> {
		await this.inner.releaseIfOurs();
	}
}
