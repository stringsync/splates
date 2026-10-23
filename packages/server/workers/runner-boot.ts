import type { Ps } from "webappwiz/system";
import type { RunnerBoot } from "../cloud/fly-runners";
import { RUNNING, sourceCommit } from "../server/release";
import { OwnBuild } from "./own-build";
import { RunnerImages } from "./runner-images";

/**
 * What runners boot for this splates: the release image of its version, and,
 * when it runs from a checkout, which may be ahead of that release, its own
 * build bundled, which the runner is handed before it serves a job.
 */
export class SplatesRunnerBoot implements RunnerBoot {
	private checkout: Promise<boolean> | null = null;
	private resolved: Promise<string> | null = null;
	private readonly build = new OwnBuild({});

	constructor(
		private readonly ps: Ps,
		private readonly images = new RunnerImages(),
	) {}

	ownBuild(): Promise<boolean> {
		this.checkout ??= sourceCommit(this.ps).then((commit) => commit !== null);
		return this.checkout;
	}

	image(): Promise<string> {
		this.resolved ??= this.ownBuild()
			.then((ownBuild) => this.images.resolve(RUNNING, { ownBuild }))
			.catch((error: unknown) => {
				this.resolved = null;
				throw error;
			});
		return this.resolved;
	}

	async bundle(): Promise<Uint8Array<ArrayBuffer>> {
		return new TextEncoder().encode(await this.build.bundle());
	}
}
