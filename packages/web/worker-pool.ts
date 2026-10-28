import type { WorkerPool } from "@stringsync/splates-server/workers";
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
 * The Queue page's pool, as the server last said, refreshed every few
 * seconds while the page is in front. Pause or change a worker with its
 * methods; `writing` says one awaits the server. A refused change rejects,
 * for the page to say why.
 */
export class WorkerPoolView implements Eventful<WorkerPoolViewEvents> {
	private readonly dispatcher = new Dispatcher<WorkerPoolViewEvents>();
	readonly events = this.dispatcher.events;

	/** The pool as last read or changed, null before the first reading. */
	pool: WorkerPool | null = null;
	/** Why the last reading failed, or null. */
	error: string | null = null;
	/** How many writes await the server. */
	writing = 0;

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
				// A reading taken while a write is on its way would not hold it yet.
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
		return this.write(updateWorker(LOCAL, { paused }));
	}

	/** Sets `change` on worker `id`: whether it drains. */
	change(id: string, change: WorkerChange): Promise<void> {
		return this.write(updateWorker(id, change));
	}

	/** Writes, held pending until the server's reading shows it. */
	private async write(write: Promise<unknown>): Promise<void> {
		this.writing += 1;
		this.dispatcher.dispatch("changed");
		try {
			await write;
		} finally {
			this.writing -= 1;
			this.read();
		}
	}
}
