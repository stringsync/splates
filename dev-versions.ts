import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Duration } from "webappwiz/time";
import type { Served } from "./dev-project";
import { type Behind, isNewer, type Release } from "./release";

/** What `Versions` takes from `dev`'s options. */
export interface VersionsOptions {
	/** The version serving. */
	running: string;
	/** The latest arbor on npm, or null when it cannot say. */
	newest: () => Promise<string | null>;
	checkEvery: Duration;
	/** The last commit to arbor's own source, or null outside a checkout. */
	source: () => Promise<string | null>;
	sourceEvery: Duration;
}

/**
 * Whether this run of `arbor dev` is stale: a newer arbor on npm, or, run
 * from a checkout, commits to arbor's own source since it started. Each
 * project's pages are told as a check finds one.
 */
export class Versions {
	/** A newer arbor on npm, once a check has found one; every page says so. */
	private newer: Release | null = null;
	/** Commits to that source since, once a check has seen one. */
	private ahead: Behind | null = null;

	/**
	 * Versions for this run, reading arbor's source now, so a later commit
	 * to it is what makes this run stale.
	 */
	static async start(
		served: Map<string, Promise<Served>>,
		log: Logger,
		opts: VersionsOptions,
	): Promise<Versions> {
		return new Versions(served, log, await opts.source(), opts);
	}

	private constructor(
		private readonly served: Map<string, Promise<Served>>,
		private readonly log: Logger,
		/**
		 * The last commit to arbor's own source as this run started, or null
		 * when it does not run from a checkout of it.
		 */
		private readonly started: string | null,
		private readonly opts: VersionsOptions,
	) {}

	get running(): string {
		return this.opts.running;
	}

	get release(): Release | null {
		return this.newer;
	}

	get behind(): Behind | null {
		return this.ahead;
	}

	/**
	 * Checks for a newer arbor, or, run from a checkout, for commits to its
	 * source, until disposed.
	 */
	check(): Resource {
		const { checkEvery, sourceEvery } = this.opts;
		const checks =
			this.started === null
				? setInterval(() => void this.checkNpm(), checkEvery.ms)
				: setInterval(() => void this.checkSource(), sourceEvery.ms);
		if (this.started === null) {
			void this.checkNpm();
		}
		return { dispose: () => clearInterval(checks) };
	}

	// A check that fails says nothing, and the next one tries again.
	private async checkNpm(): Promise<void> {
		const { newest, running } = this.opts;
		const found = await newest();
		if (
			found === null ||
			!isNewer(found, running) ||
			found === this.newer?.newest
		) {
			return;
		}
		this.newer = { running, newest: found };
		this.log.info(
			`arbor ${found} is out (this is ${running}): restart with \`bunx @webappwiz/arbor@latest dev\``,
		);
		await this.refresh();
	}

	// From a checkout, a restart runs its source again rather than npm's arbor,
	// so commits to it are what make this run stale.
	private async checkSource(): Promise<void> {
		const found = await this.opts.source();
		const { started } = this;
		if (
			started === null ||
			found === null ||
			found === started ||
			found === this.ahead?.newest
		) {
			return;
		}
		this.ahead = { running: started, newest: found };
		this.log.info(
			`arbor's source is at ${found.slice(0, 8)} (this runs ${started.slice(0, 8)}): restart to pick it up`,
		);
		await this.refresh();
	}

	/** Tells each project's pages to read it again. */
	private async refresh(): Promise<void> {
		for (const settled of await Promise.allSettled(this.served.values())) {
			if (settled.status === "fulfilled") {
				settled.value.refresh();
			}
		}
	}
}
