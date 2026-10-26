import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Logger } from "webappwiz/log";
import type { Lock } from "webappwiz/system";
import {
	type Clock,
	Duration,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import type { Accounting, JobRun } from "./accounting";
import type { Allocation, JobRequest, JobSpec, JobSubmitter } from "./job";
import type { JobListing } from "./listing";
import type { Pools } from "./pools";
import { type JobOwner, ScheduledJob } from "./scheduled-job";

/** A waiting job's priority rises one for each of these it has waited. */
export const AGE_STEP = Duration.mins(1);
/** The most age adds, so a low job never passes a high one by waiting alone. */
export const AGE_CAP = 30;
/** How much higher a job must be than a running one to preempt it, so near-equals never thrash. */
export const PREEMPT_GAP = 10;
/** How often the queue is looked at with nothing else happening, for walltimes and the machine's load. */
export const TICK = Duration.secs(2);
/**
 * How soon a head job expected to fit at no running job's end, since the
 * person's own load is in the way, is reserved for.
 */
export const EXTERNAL_WAIT = Duration.mins(1);

export interface SchedulerEvents extends Record<string, unknown> {
	/** A job started, ended, moved, or was told its place. */
	changed: undefined;
}

export interface JobSchedulerOptions {
	clock: Clock;
	timer: Timer;
	log: Logger;
	/** Stamps accounting's records. */
	wall?: WallClock;
	/**
	 * A pool whose holder takes a lock as well, held while a job holding any
	 * of it runs, so a process outside the scheduler holding that lock
	 * excludes the job and the job excludes it.
	 */
	exclusive?: { pool: string; lock: Lock };
	tick?: Duration;
}

/**
 * The machine's batch job scheduler: jobs submitted with a request wait in
 * one queue by priority, then age, and start as their request fits what the
 * pools have free. The head that cannot fit reserves the earliest time it
 * can, and EASY backfill starts lower jobs behind it only when they are out
 * of its way by then; a job that cannot fit preempts lower requeue-able
 * jobs when that makes room. Runs past their walltime expire.
 */
export class JobScheduler
	implements JobSubmitter, JobOwner, Eventful<SchedulerEvents>, Resource
{
	readonly #dispatcher = new Dispatcher<SchedulerEvents>();
	readonly events = this.#dispatcher.events;
	readonly #jobs = new Map<string, ScheduledJob>();
	readonly #ticking: Resource;
	readonly #wall: WallClock;
	#sweeping: Promise<void> = Promise.resolve();
	#busy = false;
	#again = false;
	#issued = 0;
	#paused = false;

	constructor(
		private readonly pools: Pools,
		private readonly accounting: Accounting,
		private readonly opts: JobSchedulerOptions,
	) {
		this.#wall = opts.wall ?? new SystemWallClock();
		this.#ticking = opts.timer.setInterval(() => {
			void this.sweep();
		}, opts.tick ?? TICK);
	}

	async submit(spec: JobSpec, signal?: AbortSignal): Promise<ScheduledJob> {
		signal?.throwIfAborted();
		const expected =
			spec.request.expected ??
			(await this.accounting.expected(spec.what)) ??
			spec.request.walltime;
		const job = new ScheduledJob(
			String(++this.#issued),
			spec,
			this.opts.clock.now(),
			expected,
			this,
		);
		this.#jobs.set(job.id, job);
		signal?.addEventListener(
			"abort",
			() => {
				void this.finish(job);
			},
			{ once: true },
		);
		await this.sweep();
		return job;
	}

	find(id: string): ScheduledJob | null {
		return this.#jobs.get(id) ?? null;
	}

	async renew(job: ScheduledJob): Promise<void> {
		if (job.state === "running") {
			job.deadline = this.opts.clock.now().add(job.spec.request.walltime);
		}
	}

	async finish(job: ScheduledJob): Promise<void> {
		await this.#end(job, job.state === "waiting" ? "cancelled" : "done");
		await this.sweep();
	}

	/** Starts no job until resumed; running ones finish. */
	pause(): void {
		this.#paused = true;
		this.#dispatcher.dispatch("changed");
	}

	resume(): void {
		this.#paused = false;
		void this.sweep();
	}

	list(): JobListing {
		const now = this.opts.clock.now();
		const jobs = [...this.#jobs.values()];
		return {
			paused: this.#paused,
			running: jobs
				.filter((job) => job.allocation !== null)
				.map((job) => ({
					...listed(job),
					allocation: job.allocation ?? {},
					ranMs: now.subtract(job.startedAt ?? now).ms,
					expectedMs: job.expected.ms,
				})),
			waiting: jobs
				.filter((job) => job.place !== null)
				.sort((one, other) => (one.place ?? 0) - (other.place ?? 0))
				.map((job) => ({
					...listed(job),
					place: job.place ?? 0,
					waitedMs: now.subtract(job.submittedAt).ms,
					effective: this.#effective(job, now),
				})),
		};
	}

	/** Looks at the queue once more, after any look under way. */
	sweep(): Promise<void> {
		this.#again = true;
		if (!this.#busy) {
			this.#sweeping = this.#run();
		}
		return this.#sweeping;
	}

	dispose(): void {
		this.#ticking.dispose();
		for (const job of this.#jobs.values()) {
			job.dispatcher.dispose();
		}
		this.#jobs.clear();
		this.#dispatcher.dispose();
	}

	async #run(): Promise<void> {
		this.#busy = true;
		try {
			while (this.#again) {
				this.#again = false;
				await this.#pass();
			}
		} catch (error) {
			this.opts.log.error(
				`jobs: the queue could not be looked at: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			this.#busy = false;
		}
	}

	async #pass(): Promise<void> {
		const now = this.opts.clock.now();
		for (const job of this.#jobs.values()) {
			if (job.deadline !== null && now.ms >= job.deadline.ms) {
				await this.#end(job, "expired");
			}
		}
		const capacity = await this.pools.capacity();
		const free = this.#free(capacity, await this.pools.used());
		const waiting = [...this.#jobs.values()]
			.filter((job) => job.state === "waiting")
			.sort(
				(one, other) =>
					this.#effective(other, now) - this.#effective(one, now) ||
					one.submittedAt.ms - other.submittedAt.ms,
			);
		let reservation: Reservation | null = null;
		let place = 0;
		for (const job of waiting) {
			if (!this.#paused) {
				const alloc = fit(job.spec.request, free);
				if (
					alloc !== null &&
					(reservation === null || this.#clears(job, alloc, now, reservation))
				) {
					this.#start(job, alloc);
					subtract(free, alloc);
					continue;
				}
				if (reservation === null) {
					const made = this.#preempt(job, free, now);
					if (made !== null) {
						this.#start(job, made);
						subtract(free, made);
						continue;
					}
					reservation = this.#reserve(job, free, capacity, now);
				}
			}
			place++;
			if (job.place !== place) {
				job.place = place;
				job.dispatcher.dispatch("placed", place);
			}
		}
		this.#dispatcher.dispatch("changed");
	}

	/** Each pool's capacity less what is allocated and what is measured in use beyond that. */
	#free(
		capacity: Record<string, number>,
		used: Record<string, number>,
	): Record<string, number> {
		const allocated: Record<string, number> = {};
		for (const job of this.#jobs.values()) {
			if (job.allocation !== null) {
				add(allocated, job.allocation);
			}
		}
		const free: Record<string, number> = {};
		for (const [pool, whole] of Object.entries(capacity)) {
			const ours = allocated[pool] ?? 0;
			const external = Math.max(0, (used[pool] ?? 0) - ours);
			free[pool] = whole - ours - external;
		}
		return free;
	}

	#effective(job: ScheduledJob, now: Duration): number {
		const waited = now.subtract(job.submittedAt).ms;
		return (
			job.spec.priority + Math.min(AGE_CAP, Math.floor(waited / AGE_STEP.ms))
		);
	}

	/** Whether `job`, started now on `alloc`, is out of the reserved job's way by its time. */
	#clears(
		job: ScheduledJob,
		alloc: Allocation,
		now: Duration,
		reservation: Reservation,
	): boolean {
		if (now.add(job.expected).ms <= reservation.at.ms) {
			return true;
		}
		if (fits(alloc, reservation.free)) {
			subtract(reservation.free, alloc);
			return true;
		}
		return false;
	}

	/** When `job` is expected to fit, as running jobs end when expected, and what is free beside it then. */
	#reserve(
		job: ScheduledJob,
		free: Record<string, number>,
		capacity: Record<string, number>,
		now: Duration,
	): Reservation {
		const need = least(job.spec.request);
		const avail = { ...free };
		const ending = [...this.#jobs.values()]
			.filter((each) => each.allocation !== null)
			.map((each) => ({ job: each, at: this.#endOf(each, now) }))
			.sort((one, other) => one.at.ms - other.at.ms);
		for (const { job: each, at } of ending) {
			add(avail, each.allocation ?? {});
			if (fits(need, avail)) {
				return { at, free: subtract(avail, need) };
			}
		}
		return {
			at: now.add(EXTERNAL_WAIT),
			free: subtract({ ...capacity }, need),
		};
	}

	/** When a running job is expected to end: not before now, never after its deadline. */
	#endOf(job: ScheduledJob, now: Duration): Duration {
		const expected = (job.startedAt ?? now).add(job.expected);
		const end = expected.ms > now.ms ? expected : now;
		return job.deadline !== null && job.deadline.ms < end.ms
			? job.deadline
			: end;
	}

	/**
	 * Stops the lowest requeue-able running jobs far enough under `job` that
	 * it fits once they are gone, and gives their room; null when none would.
	 */
	#preempt(
		job: ScheduledJob,
		free: Record<string, number>,
		now: Duration,
	): Allocation | null {
		const ceiling = this.#effective(job, now) - PREEMPT_GAP;
		const victims = [...this.#jobs.values()]
			.filter(
				(each) =>
					each.allocation !== null &&
					each.spec.requeueable === true &&
					this.#effective(each, now) <= ceiling,
			)
			.sort(
				(one, other) =>
					this.#effective(one, now) - this.#effective(other, now) ||
					(other.startedAt?.ms ?? 0) - (one.startedAt?.ms ?? 0),
			);
		const avail = { ...free };
		const taken: ScheduledJob[] = [];
		for (const victim of victims) {
			add(avail, victim.allocation ?? {});
			taken.push(victim);
			const alloc = fit(job.spec.request, avail);
			if (alloc !== null) {
				for (const each of taken) {
					add(free, each.allocation ?? {});
					void this.#end(each, "preempted");
				}
				// The preempted wait again: the next pass gives them their places.
				this.#again = true;
				return alloc;
			}
		}
		return null;
	}

	#start(job: ScheduledJob, alloc: Allocation): void {
		job.state = "starting";
		job.allocation = alloc;
		job.place = null;
		void this.#hold(job);
	}

	/** Takes the exclusive lock when the job holds any of its pool, then lets it run. */
	async #hold(job: ScheduledJob): Promise<void> {
		const exclusive = this.opts.exclusive;
		if (exclusive && (job.allocation?.[exclusive.pool] ?? 0) > 0) {
			await exclusive.lock.acquire();
			if (job.state !== "starting") {
				await exclusive.lock.release();
				return;
			}
			job.holdsLock = true;
		}
		if (job.state !== "starting") {
			return;
		}
		job.state = "running";
		const now = this.opts.clock.now();
		job.startedAt = now;
		job.deadline = now.add(job.spec.request.walltime);
		job.dispatcher.dispatch("started", job.allocation ?? {});
		this.#dispatcher.dispatch("changed");
	}

	async #end(
		job: ScheduledJob,
		outcome: JobRun["outcome"] | "cancelled",
	): Promise<void> {
		if (job.state === "done") {
			return;
		}
		const held = job.allocation;
		const ran =
			job.startedAt === null
				? 0
				: this.opts.clock.now().subtract(job.startedAt).ms;
		job.state = outcome === "preempted" ? "waiting" : "done";
		job.allocation = null;
		job.startedAt = null;
		job.deadline = null;
		if (job.state === "done") {
			this.#jobs.delete(job.id);
		}
		if (job.holdsLock) {
			job.holdsLock = false;
			await this.opts.exclusive?.lock.release();
		}
		if (held !== null && outcome !== "cancelled") {
			await this.accounting
				.record(job.spec.what, {
					at: new Date(this.#wall.now()).toISOString(),
					ms: ran,
					allocation: held,
					outcome,
				})
				.catch((error: unknown) => {
					this.opts.log.error(
						`jobs: ${job.spec.what} could not be accounted: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
		}
		if (outcome === "expired" || outcome === "preempted") {
			job.dispatcher.dispatch(outcome);
		}
		if (job.state === "done") {
			job.dispatcher.dispose();
		}
		this.#dispatcher.dispatch("changed");
	}
}

interface Reservation {
	/** When the head job is expected to fit. */
	at: Duration;
	/** What is free beside it then, which a backfilled job still running may take. */
	free: Record<string, number>;
}

function listed(job: ScheduledJob) {
	const { what, task, conversation, priority, request } = job.spec;
	return {
		id: job.id,
		what,
		...(task === undefined ? {} : { task }),
		...(conversation === undefined ? {} : { conversation }),
		priority,
		request: {
			resources: request.resources,
			walltimeMs: request.walltime.ms,
			...(request.expected === undefined
				? {}
				: { expectedMs: request.expected.ms }),
		},
	};
}

/** What `request` would take of `free`: each range filled up to what is free; null when any is short. */
function fit(
	request: JobRequest,
	free: Record<string, number>,
): Allocation | null {
	const alloc: Allocation = {};
	for (const [pool, amount] of Object.entries(request.resources)) {
		const avail = Math.floor(free[pool] ?? 0);
		const min = typeof amount === "number" ? amount : amount.min;
		const max = typeof amount === "number" ? amount : amount.max;
		if (avail < min) {
			return null;
		}
		alloc[pool] = Math.min(max, avail);
	}
	return alloc;
}

/** The least `request` takes of each pool. */
function least(request: JobRequest): Allocation {
	return Object.fromEntries(
		Object.entries(request.resources).map(([pool, amount]) => [
			pool,
			typeof amount === "number" ? amount : amount.min,
		]),
	);
}

function fits(need: Allocation, free: Record<string, number>): boolean {
	return Object.entries(need).every(
		([pool, amount]) => (free[pool] ?? 0) >= amount,
	);
}

function add(
	into: Record<string, number>,
	amounts: Allocation,
): Record<string, number> {
	for (const [pool, amount] of Object.entries(amounts)) {
		into[pool] = (into[pool] ?? 0) + amount;
	}
	return into;
}

function subtract(
	from: Record<string, number>,
	amounts: Allocation,
): Record<string, number> {
	for (const [pool, amount] of Object.entries(amounts)) {
		from[pool] = (from[pool] ?? 0) - amount;
	}
	return from;
}
