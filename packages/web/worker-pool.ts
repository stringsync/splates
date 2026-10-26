import type {
	WorkerListing,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import { WindowBackgroundObserver } from "webappwiz/browser";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, SystemTimer } from "webappwiz/time";
import { updateWorker, type WorkerChange, workerPool } from "./api";
import { LOCAL } from "./local-worker";

export type WorkerPoolViewEvents = { changed: undefined };

/** How often the page asks after the pool, while in front. */
const EVERY = Duration.secs(5);

/**
 * The Queue page's pool: read every few seconds while the page is in
 * front, and changed by a method per action, each shown at once and read
 * again once its write is done, so a refused one goes back to what the
 * server says. Each action rejects as its write does, for the page to say
 * why.
 */
export class WorkerPoolView implements Eventful<WorkerPoolViewEvents> {
	private readonly dispatcher = new Dispatcher<WorkerPoolViewEvents>();
	readonly events = this.dispatcher.events;

	/** The pool as last read or changed, null before the first reading. */
	pool: WorkerPool | null = null;
	/** Why the last reading failed, or null. */
	error: string | null = null;
	// A reading taken while a write is on its way would undo what it shows.
	private writing = 0;

	/** Reads the pool now and every few seconds while the page is in front, until disposed. */
	watch(): Resource {
		const observer = new WindowBackgroundObserver();
		const ask = () => {
			if (!observer.isBackgrounded()) {
				this.read();
			}
		};
		ask();
		// Back in front, at once, rather than up to a tick late.
		observer.events.on("change", ask);
		const tick = new SystemTimer().setInterval(ask, EVERY);
		return {
			dispose: () => {
				tick.dispose();
				observer.dispose();
			},
		};
	}

	read(): void {
		workerPool().then(
			(read) => {
				if (this.writing === 0) {
					this.pool = read;
					this.error = null;
					this.dispatcher.dispatch("changed");
				}
			},
			(caught: Error) => {
				this.error = caught.message;
				this.dispatcher.dispatch("changed");
			},
		);
	}

	/**
	 * Pauses what splates starts on its own (automations, hooks, the groomer
	 * and the queue), or resumes it; the person's own agents start either way.
	 */
	pause(paused: boolean): Promise<void> {
		return this.write(
			(pool) => ({ ...pool, paused }),
			updateWorker(LOCAL, { paused }),
		);
	}

	/** Sets `change` on worker `id`: whether it drains. */
	change(id: string, change: WorkerChange): Promise<void> {
		return this.write(
			(pool) => changed(pool, id, (worker) => set(worker, change)),
			updateWorker(id, change),
		);
	}

	/** Shows `expected` of the pool at once, while `write` is on its way. */
	private async write(
		expected: (pool: WorkerPool) => WorkerPool,
		write: Promise<unknown>,
	): Promise<void> {
		this.writing += 1;
		if (this.pool !== null) {
			this.pool = expected(this.pool);
			this.dispatcher.dispatch("changed");
		}
		try {
			await write;
		} finally {
			this.writing -= 1;
			this.read();
		}
	}
}

/** `pool` with worker `id` as `change` makes it, or gone for null. */
function changed(
	pool: WorkerPool,
	id: string,
	change: (worker: WorkerListing) => WorkerListing | null,
): WorkerPool {
	return {
		...pool,
		workers: pool.workers.flatMap((worker) => {
			if (worker.id !== id) {
				return [worker];
			}
			const next = change(worker);
			return next === null ? [] : [next];
		}),
	};
}

/** `worker` as `change` sets it, before the server says so. */
function set(worker: WorkerListing, change: WorkerChange): WorkerListing {
	return {
		...worker,
		...(change.draining === undefined ? {} : { draining: change.draining }),
	};
}
