import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import {
	Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";
import { RunnerGone } from "../cloud/runner-gone";
import type { WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import type { WorkerSocket } from "./socket";

/** The longest a runner that will not answer waits before it is dialed again. */
const MOST_BETWEEN = Duration.secs(30);

/**
 * Keeps the server connected to each runner it reaches rather than one
 * that dials in: dials it once made, hands the socket to the registry as a
 * made worker's, and dials again whenever the link drops, for as long as
 * the runner's record stands and its machine exists. A runner's jobs end
 * with its link, so nothing is replayed across a redial.
 */
export class RunnerDialer implements Resource {
	private readonly dialing = new Map<string, AbortController>();
	private readonly wall: WallClock;
	private readonly wait: (duration: Duration) => Promise<void>;

	constructor(private readonly opts: RunnerDialerOptions) {
		this.wall = opts.wall ?? new SystemWallClock();
		this.wait = opts.wait ?? sleep;
	}

	/** Dials runner `id`, and keeps it dialed; nothing when it already is. */
	dial(id: string): void {
		if (this.dialing.has(id)) {
			return;
		}
		const abort = new AbortController();
		this.dialing.set(id, abort);
		void this.keep(id, abort.signal).finally(() => {
			if (this.dialing.get(id) === abort) {
				this.dialing.delete(id);
			}
		});
	}

	/** Stops dialing runner `id`, hanging up on it. */
	forget(id: string): void {
		this.dialing.get(id)?.abort();
		this.dialing.delete(id);
	}

	dispose(): void {
		for (const abort of this.dialing.values()) {
			abort.abort();
		}
		this.dialing.clear();
	}

	private wanted(id: string): boolean {
		const record = this.opts.records.of(id);
		return record?.provisioned != null && !record.removing;
	}

	private async keep(id: string, signal: AbortSignal): Promise<void> {
		let failures = 0;
		while (!signal.aborted && this.wanted(id)) {
			try {
				await this.once(id, signal);
				failures = 0;
			} catch (error) {
				if (error instanceof RunnerGone || signal.aborted) {
					return;
				}
				failures++;
				this.opts.log.error(
					`runner ${id} could not be reached: ${String(error)}`,
				);
			}
			if (!signal.aborted) {
				await this.wait(
					Duration.ms(Math.min(MOST_BETWEEN.ms, 1000 * 2 ** failures)),
				);
			}
		}
	}

	/** One link to runner `id`, from the dial until it drops. */
	private async once(id: string, signal: AbortSignal): Promise<void> {
		const socket = await this.opts.reach.reach(id, signal);
		const closed = new Promise<void>((resolve) => {
			socket.events.on("close", () => resolve());
		});
		const hangUp = () => socket.dispose();
		signal.addEventListener("abort", hangUp, { once: true });
		try {
			// The registry hears the hello only once its listener is in, so it
			// goes in before the runner is told to say it.
			const accepted = this.opts.registry.accept(socket, "provisioned", id);
			socket.send("ready");
			await accepted;
			const worker = this.opts.registry.worker(id);
			if (worker?.connected === true) {
				// Reached over TLS at its machine with its secret, so it is the runner made.
				worker.verified = true;
				if (this.opts.records.of(id)?.joinedAt === null) {
					await this.opts.records.set(id, {
						joinedAt: new Date(this.wall.now()).toISOString(),
					});
				}
			}
			await closed;
		} finally {
			signal.removeEventListener("abort", hangUp);
		}
	}
}

/** Opens the socket to a runner the server reaches. */
export interface RunnerReach {
	/** Opens worker `id`'s job socket, starting its machine as needed; throws `RunnerGone` once it is no more. */
	reach(id: string, signal?: AbortSignal): Promise<WorkerSocket>;
}

/** What a `RunnerDialer` dials with and hands its links to. */
export interface RunnerDialerOptions {
	reach: RunnerReach;
	registry: WorkerRegistry;
	records: WorkerRecords;
	log: Logger;
	wall?: WallClock;
	wait?: (duration: Duration) => Promise<void>;
}
