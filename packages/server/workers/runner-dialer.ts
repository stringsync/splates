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

/** How long a runner whose link dropped is watched for stopping itself before it is dialed again. */
const SETTLE_FOR = Duration.secs(30);

/** How often it is looked at in that time. */
const SETTLE_EVERY = Duration.secs(2);

/** The longest a runner that will not answer waits before it is dialed again. */
const MOST_BETWEEN = Duration.secs(30);

/**
 * Keeps the server connected to each runner it reaches rather than one
 * that dials in: dials it once made, hands the socket to the registry as a
 * made worker's, and dials again whenever the link drops, for as long as
 * the runner's record stands and its machine exists. A runner's jobs end
 * with its link, so nothing is replayed across a redial.
 *
 * A runner stops its machine itself once it has stood idle, which is not a
 * link to redial: it sleeps until `wake`, which a job waiting for room
 * calls, so nothing starts a machine nobody has work for.
 */
export class RunnerDialer implements Resource {
	private readonly dialing = new Map<string, AbortController>();
	/** The runners stopped and left so, each with what wakes it. */
	private readonly sleepers = new Map<string, () => void>();
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

	/** The runners asleep: stopped, and dialed again only once woken. */
	sleeping(): string[] {
		return [...this.sleepers.keys()];
	}

	/** Wakes runner `id`, which dials it, starting its machine; false when it does not sleep. */
	wake(id: string): boolean {
		const wake = this.sleepers.get(id);
		if (wake === undefined) {
			return false;
		}
		wake();
		return true;
	}

	/** Stops dialing runner `id`, hanging up on it. */
	forget(id: string): void {
		this.dialing.get(id)?.abort();
		this.dialing.delete(id);
	}

	dispose(): void {
		for (const wake of [...this.sleepers.values()]) {
			wake();
		}
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
				if (await this.asleep(id)) {
					this.opts.slept?.(id);
					await this.sleep(id, signal);
				}
				if (signal.aborted) {
					return;
				}
				await this.once(id, signal);
				failures = 0;
				await this.settle(id, signal);
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

	private async asleep(id: string): Promise<boolean> {
		return (await this.opts.reach.asleep?.(id)) ?? false;
	}

	/** Parks runner `id` until it is woken, or its dialing stops. */
	private async sleep(id: string, signal: AbortSignal): Promise<void> {
		await new Promise<void>((resolve) => {
			this.sleepers.set(id, resolve);
			signal.addEventListener("abort", () => resolve(), { once: true });
		});
		this.sleepers.delete(id);
		if (!signal.aborted) {
			this.opts.woke?.(id);
		}
	}

	/** Gives a runner whose link just dropped time to be seen stopped, so the next look parks it rather than starting it again. */
	private async settle(id: string, signal: AbortSignal): Promise<void> {
		const until = this.wall.now() + SETTLE_FOR.ms;
		while (!signal.aborted && this.wall.now() < until) {
			if (await this.asleep(id).catch(() => false)) {
				return;
			}
			await this.wait(SETTLE_EVERY);
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
	/** Whether worker `id`'s machine is stopped or stopping, which no one is to start but a job waiting for room. */
	asleep?(id: string): Promise<boolean>;
}

/** What a `RunnerDialer` dials with and hands its links to. */
export interface RunnerDialerOptions {
	reach: RunnerReach;
	registry: WorkerRegistry;
	records: WorkerRecords;
	log: Logger;
	/** Told when a runner is found stopped, for it to stop counting as running. */
	slept?: (id: string) => void;
	/** Told when a sleeping runner is woken, before its machine is started. */
	woke?: (id: string) => void;
	wall?: WallClock;
	wait?: (duration: Duration) => Promise<void>;
}
