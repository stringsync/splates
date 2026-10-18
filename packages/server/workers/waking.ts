import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Logger } from "webappwiz/log";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import {
	couldRun,
	type Pool,
	type PoolWorker,
	type Scheduler,
} from "./scheduler";

/**
 * How long a woken worker has to join before placement stops counting on
 * it and makes a worker instead, so a machine that does not wake never
 * holds the queue up.
 */
export const WAKE_WITHIN = Duration.mins(2);

export type WorkerWakingEvents = {
	/** Worker `id` was not woken: it did not join in time, or no packet could be sent. */
	missed: string;
};

/**
 * Wakes sleeping workers for the queue, before any is made: a free awake
 * slot comes first, which placement gives at once; then, watching a
 * scheduler, it wakes a sleeping worker for those still waiting that it
 * could take; and only what that would not seat is left to provisioning,
 * which counts the slots of workers waking as on their way (`seats`). One
 * that has not joined within `WAKE_WITHIN` is counted on no longer, and is
 * not woken for the queue again until it joins on its own, though the
 * person may still wake it.
 */
export class WorkerWaking implements Eventful<WorkerWakingEvents>, Resource {
	private readonly dispatcher = new Dispatcher<WorkerWakingEvents>();
	readonly events = this.dispatcher.events;
	/** Workers woken that have yet to join, by id, with their slots and the timeout that gives up on them. */
	private readonly woken = new Map<
		string,
		{ slots: number; timeout: Resource }
	>();
	/** Workers that missed a wake, which the queue wakes no more until they join. */
	private readonly missed = new Set<string>();
	private readonly timer: Timer;
	private watching: (() => void) | null = null;

	constructor(private readonly opts: WorkerWakingOptions) {
		this.timer = opts.timer ?? new SystemTimer();
	}

	/** Wakes workers for `scheduler`'s queue as it changes, until disposed. */
	watch(scheduler: Scheduler): void {
		this.watching?.();
		this.watching = scheduler.events.on("changed", () => this.look(scheduler));
		this.look(scheduler);
	}

	/** Whether worker `id` was woken and has yet to join. */
	waking(id: string): boolean {
		return this.woken.has(id);
	}

	/** The slots of the workers woken that have yet to join, which those queued count on. */
	seats(): number {
		return [...this.woken.values()].reduce((sum, { slots }) => sum + slots, 0);
	}

	/**
	 * Worker `id` joined, so it is waking no longer, and may be woken for
	 * the queue again once it sleeps; answers whether it was woken, so the
	 * wake worked.
	 */
	joined(id: string): boolean {
		this.missed.delete(id);
		const woken = this.woken.get(id);
		woken?.timeout.dispose();
		this.woken.delete(id);
		return woken !== undefined;
	}

	/**
	 * Wakes worker `id` now, as the person asks; answers once its packet is
	 * sent, throwing when none could be.
	 */
	async wake(id: string): Promise<void> {
		const worker = this.opts.pool.workers().find((each) => each.id === id);
		if (worker?.asleep !== true) {
			throw new Error(`worker ${id} is not asleep`);
		}
		this.missed.delete(id);
		await this.start(worker);
	}

	/**
	 * Wakes sleeping workers, one at a time in pool order, while those
	 * queued outnumber the slots on their way and one could take any of
	 * them.
	 */
	private look(scheduler: Scheduler): void {
		const workers = this.opts.pool.workers();
		const queued = scheduler.queue();
		let uncovered = queued.length - this.seats();
		for (const worker of workers) {
			if (uncovered <= 0) {
				return;
			}
			if (
				worker.asleep !== true ||
				this.woken.has(worker.id) ||
				this.missed.has(worker.id) ||
				!queued.some((entry) => couldRun(worker, entry))
			) {
				continue;
			}
			uncovered -= worker.slots;
			void this.start(worker).catch(() => {});
		}
	}

	private async start(worker: PoolWorker): Promise<void> {
		const { id } = worker;
		if (!this.woken.has(id)) {
			this.woken.set(id, {
				slots: worker.slots,
				timeout: this.timer.setTimeout(() => {
					this.miss(id, `it did not join within ${WAKE_WITHIN.secs}s`);
				}, this.opts.within ?? WAKE_WITHIN),
			});
		}
		try {
			await this.opts.send(id);
			this.opts.log.info(`woke worker ${id}`);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.miss(id, reason);
			throw error;
		}
	}

	/** Gives up on waking worker `id`, for placement to make one instead. */
	private miss(id: string, reason: string): void {
		const woken = this.woken.get(id);
		if (woken === undefined) {
			return;
		}
		woken.timeout.dispose();
		this.woken.delete(id);
		this.missed.add(id);
		this.opts.log.info(`worker ${id} was not woken: ${reason}`);
		this.dispatcher.dispatch("missed", id);
	}

	dispose(): void {
		this.watching?.();
		this.watching = null;
		for (const { timeout } of this.woken.values()) {
			timeout.dispose();
		}
		this.woken.clear();
		this.dispatcher.dispose();
	}
}

/** What `WorkerWaking` wakes workers with. */
export interface WorkerWakingOptions {
	/** The workers placement sees, asleep ones among them. */
	pool: Pool;
	/** Sends the packet that wakes worker `id`, throwing when none can be. */
	send(id: string): Promise<void>;
	/** How long a woken worker has to join; `WAKE_WITHIN` by default. */
	within?: Duration;
	timer?: Timer;
	log: Logger;
}
