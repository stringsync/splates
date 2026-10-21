import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { type Clock, Duration, type Timer } from "webappwiz/time";
import type { Scheduler } from "./scheduler";

/** How long a worker may be away before its agents carry on elsewhere. */
export const GONE_AFTER = Duration.mins(15);

/** How often `GoneWorkers` looks. */
const LOOK_EVERY = Duration.mins(1);

/**
 * Frees the slots held on a worker that has been away `after`, as a
 * machine turned off or carried off is, so each agent there carries on
 * elsewhere from what its task last pushed, as when the worker is removed.
 * One that comes back in time takes its agents back up as before. This
 * machine's own worker is never let go of: it goes with the server.
 */
export class GoneWorkers implements Resource {
	/** Since when each worker away is known to be, by id. */
	private readonly away = new Map<string, number>();
	private readonly look: Resource;

	constructor(private readonly opts: GoneWorkersOptions) {
		this.look = opts.timer.setInterval(() => this.check(), LOOK_EVERY);
	}

	/** Frees each worker away past the bound that holds a slot. */
	private check(): void {
		const { workers, scheduler, clock, log } = this.opts;
		const after = this.opts.after ?? GONE_AFTER;
		const now = clock.now().ms;
		const holding = new Set(scheduler.held().map(({ worker }) => worker));
		for (const { id, connected } of workers()) {
			if (connected) {
				this.away.delete(id);
				continue;
			}
			const since = this.away.get(id) ?? now;
			this.away.set(id, since);
			if (now - since >= after.ms && holding.has(id)) {
				log.info(
					`worker ${id} has been away ${after.human()}: its agents carry on elsewhere from their last push`,
				);
				scheduler.release(id, `worker ${id} has been away ${after.human()}`);
			}
		}
	}

	dispose(): void {
		this.look.dispose();
	}
}

/** What `GoneWorkers` watches. */
export interface GoneWorkersOptions {
	/** Each worker but this machine's own, and whether it is connected now. */
	workers: () => { id: string; connected: boolean }[];
	scheduler: Pick<Scheduler, "held" | "release">;
	timer: Timer;
	clock: Clock;
	log: Logger;
	after?: Duration;
}
