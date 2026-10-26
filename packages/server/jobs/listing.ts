import type { Allocation, JobRequestJson } from "./job";

/** A job as the queue lists it, for the page and `GET /api/jobs`. */
export interface ListedJob {
	id: string;
	what: string;
	task?: string;
	conversation?: string;
	priority: number;
	request: JobRequestJson;
}

export interface RunningJob extends ListedJob {
	allocation: Allocation;
	/** How long it has run, or waited to take its exclusive lock. */
	ranMs: number;
	/** How long it is expected to run in all. */
	expectedMs: number;
}

export interface WaitingJob extends ListedJob {
	/** 1 is next. */
	place: number;
	waitedMs: number;
	/** Its priority with its age added. */
	effective: number;
}

/** The scheduler's queue: what runs, what waits in line, and whether starts are paused. */
export interface JobListing {
	running: RunningJob[];
	waiting: WaitingJob[];
	paused: boolean;
}
