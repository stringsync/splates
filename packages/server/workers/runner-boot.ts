import type { Ps } from "webappwiz/system";
import type { RunnerBinary, RunnerBoot } from "../cloud/fly-runners";
import { RUNNING, sourceCommit } from "../server/release";
import { OwnBuild } from "./own-build";
import { RunnerBinaries } from "./runner-binaries";
import { RunnerImages } from "./runner-images";

/**
 * What runners boot for this splates: the project's own image when it names
 * one (`runner.image`), else the release image of its version, the
 * release's compiled binary their bootstrap fetches, and, when it runs from a
 * checkout, which may be ahead of that release, its own build bundled, which
 * the runner is handed before it serves a job.
 */
export class SplatesRunnerBoot implements RunnerBoot {
	private checkout: Promise<boolean> | null = null;
	private resolved: Promise<string> | null = null;
	private fetched: Promise<RunnerBinary> | null = null;
	private readonly build = new OwnBuild({});

	private readonly images: RunnerImages;
	private readonly binaries: RunnerBinaries;
	private readonly own: string | null;

	constructor(
		private readonly ps: Ps,
		opts: SplatesRunnerBootOptions = {},
	) {
		this.images = opts.images ?? new RunnerImages();
		this.binaries = opts.binaries ?? new RunnerBinaries();
		this.own = opts.image ?? null;
	}

	ownBuild(): Promise<boolean> {
		this.checkout ??= sourceCommit(this.ps).then((commit) => commit !== null);
		return this.checkout;
	}

	image(): Promise<string> {
		if (this.own !== null) {
			return Promise.resolve(this.own);
		}
		this.resolved ??= this.ownBuild()
			.then((ownBuild) => this.images.resolve(RUNNING, { ownBuild }))
			.catch((error: unknown) => {
				this.resolved = null;
				throw error;
			});
		return this.resolved;
	}

	binary(): Promise<RunnerBinary> {
		this.fetched ??= this.ownBuild()
			.then((ownBuild) => this.binaries.resolve(RUNNING, { ownBuild }))
			.catch((error: unknown) => {
				this.fetched = null;
				throw error;
			});
		return this.fetched;
	}

	async bundle(): Promise<Uint8Array<ArrayBuffer>> {
		return new TextEncoder().encode(await this.build.bundle());
	}
}

/** What `SplatesRunnerBoot` takes beside the process runner. */
export interface SplatesRunnerBootOptions {
	images?: RunnerImages;
	binaries?: RunnerBinaries;
	/** The project's own `runner.image`, booted instead of the release image. */
	image?: string | null;
}
