import { Dispatcher } from "webappwiz/events";
import type { Duration } from "webappwiz/time";
import type { Allocation, JobEvents, JobHandle, JobSpec } from "./job";

/** What a job's scheduler does for it when its holder asks. */
export interface JobOwner {
	renew(job: ScheduledJob): Promise<void>;
	finish(job: ScheduledJob): Promise<void>;
}

/**
 * A job in the scheduler's queue or running on its allocation: the handle
 * its submitter holds, and the record the scheduler keeps. Times are the
 * scheduler's clock's.
 */
export class ScheduledJob implements JobHandle {
	readonly dispatcher = new Dispatcher<JobEvents>();
	readonly events = this.dispatcher.events;
	/** Waiting in the queue; starting, taking its exclusive lock; running; done and gone. */
	state: "waiting" | "starting" | "running" | "done" = "waiting";
	allocation: Allocation | null = null;
	/** When it began running, null while waiting or starting. */
	startedAt: Duration | null = null;
	/** When it expires, its walltime from when it began, renewed by its holder. */
	deadline: Duration | null = null;
	/** Its place in line while waiting, 1 next; null once started. */
	place: number | null = null;
	/** Whether it holds the scheduler's exclusive lock, taken for its exclusive pool. */
	holdsLock = false;

	constructor(
		readonly id: string,
		readonly spec: JobSpec,
		/** When it was submitted, which its age counts from, preemptions included. */
		readonly submittedAt: Duration,
		/** How long it is expected to run, for reservations and backfill. */
		readonly expected: Duration,
		private readonly owner: JobOwner,
	) {}

	renew(): Promise<void> {
		return this.owner.renew(this);
	}

	finish(): Promise<void> {
		return this.owner.finish(this);
	}
}
