import type { Resource } from "core/disposable";
import type { Logger } from "core/log";
import type { Duration } from "core/time";
import type { Served } from "./project";
import { type Behind, isNewer, type Release, type Stuck } from "./release";

/** What `Versions` takes from `dev`'s options. */
export interface VersionsOptions {
	/** The version serving. */
	running: string;
	/** The latest splates on npm, or null when it cannot say. */
	newest: () => Promise<string | null>;
	checkEvery: Duration;
	/** The last commit to splates's own source, or null outside a checkout. */
	source: () => Promise<string | null>;
	/** Whether the source checkout is behind its upstream branch on server commits. */
	stuck?: () => Promise<Stuck | null>;
	sourceEvery: Duration;
}

/**
 * Whether this run of `splates server` is stale: a newer splates on npm, or, run
 * from a checkout, commits to splates's own source since it started, or
 * upstream server commits the local checkout failed to follow. Each project's
 * pages are told as a check finds one.
 */
export class Versions {
	/** A newer splates on npm, once a check has found one; every page says so. */
	private newer: Release | null = null;
	/** Commits to that source since, once a check has seen one. */
	private ahead: Behind | null = null;
	/** Upstream server commits the local source checkout has not followed yet. */
	private blocked: Stuck | null = null;

	/**
	 * Versions for this run, reading splates's source now, so a later commit
	 * to it is what makes this run stale.
	 */
	static async start(
		served: Map<string, Promise<Served>>,
		log: Logger,
		opts: VersionsOptions,
	): Promise<Versions> {
		const started = await opts.source();
		const blocked =
			started === null || opts.stuck === undefined ? null : await opts.stuck();
		return new Versions(served, log, started, blocked, opts);
	}

	private constructor(
		private readonly served: Map<string, Promise<Served>>,
		private readonly log: Logger,
		/**
		 * The last commit to splates's own source as this run started, or null
		 * when it does not run from a checkout of it.
		 */
		private readonly started: string | null,
		initialStuck: Stuck | null,
		private readonly opts: VersionsOptions,
	) {
		this.blocked = initialStuck;
	}

	get running(): string {
		return this.opts.running;
	}

	get release(): Release | null {
		return this.newer;
	}

	get behind(): Behind | null {
		return this.ahead;
	}

	get stuck(): Stuck | null {
		return this.blocked;
	}

	/**
	 * Checks for a newer splates, or, run from a checkout, for commits to its
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
			`splates ${found} is out (this is ${running}): restart with \`bunx @stringsync/splates@latest dev\``,
		);
		await this.refresh();
	}

	// From a checkout, a restart runs its source again rather than npm's splates,
	// so commits to it are what make this run stale. Also check whether the
	// checkout's upstream branch moved ahead while local HEAD stayed behind.
	private async checkSource(): Promise<void> {
		const { started } = this;
		if (started === null) {
			return;
		}
		const [found, stuck] = await Promise.all([
			this.opts.source(),
			this.opts.stuck?.() ?? Promise.resolve(null),
		]);
		let changed = false;
		if (found !== null && found !== started && found !== this.ahead?.newest) {
			this.ahead = { running: started, newest: found };
			this.log.info(
				`splates's source is at ${found.slice(0, 8)} (this runs ${started.slice(0, 8)}): restart to pick it up`,
			);
			changed = true;
		}
		if (!sameStuck(this.blocked, stuck)) {
			if (stuck !== null && stuck.newest !== this.blocked?.newest) {
				this.log.info(
					`splates's checkout is ${stuck.commits} server ${stuck.commits === 1 ? "commit" : "commits"} behind ${stuck.upstream} (local ${stuck.local.slice(0, 8)}, upstream ${stuck.newest.slice(0, 8)})`,
				);
			}
			this.blocked = stuck;
			changed = true;
		}
		if (changed) {
			await this.refresh();
		}
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

function sameStuck(prev: Stuck | null, next: Stuck | null): boolean {
	if (prev === next) {
		return true;
	}
	if (prev === null || next === null) {
		return false;
	}
	return (
		prev.upstream === next.upstream &&
		prev.local === next.local &&
		prev.newest === next.newest &&
		prev.commits === next.commits &&
		prev.root === next.root &&
		prev.dirty === next.dirty
	);
}
