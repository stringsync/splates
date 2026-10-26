import type { Eventful } from "webappwiz/events";
import type { Duration } from "webappwiz/time";

/**
 * An amount of one pool a job asks for: a number, or a range the scheduler
 * fills from what is free, never under `min` and never over `max`.
 */
export type Amount = number | { min: number; max: number };

/** What a job needs of the machine's pools, and for how long. */
export interface JobRequest {
	/** By pool: `cpus`, `mem` in megabytes, `suite` for the one tree a whole suite runs in. */
	resources: Record<string, Amount>;
	/** How long it may run once started; past it, it is told it expired. */
	walltime: Duration;
	/**
	 * How long it is expected to run, for backfill and reservations;
	 * accounting's estimate for the same `what` when left out, else the walltime.
	 */
	expected?: Duration;
}

/** A job as submitted: what runs, for whom, how urgent, and what it needs. */
export interface JobSpec {
	/** The command, which accounting keys past runs by. */
	what: string;
	task?: string;
	conversation?: string;
	/**
	 * Higher goes first; ages a step a minute while waiting. Set by the code
	 * path that submits, from `Priority`, never by an agent.
	 */
	priority: number;
	/** Whether a higher job that cannot fit may stop it, sending it back to the queue to start over. */
	requeueable?: boolean;
	request: JobRequest;
}

/** The priorities the submitting paths use, as QoS levels. */
export const Priority = {
	/** A merge's gate: a task's landing and the merges batched behind it wait on it. */
	high: 100,
	/** A task's start: its install. */
	normal: 50,
	/** An agent's own checks and runs. */
	low: 0,
} as const;

/** What a started job was given of each pool it asked for. */
export type Allocation = Record<string, number>;

export interface JobEvents extends Record<string, unknown> {
	/** Its place in line while it waits, 1 next; told as it changes. */
	placed: number;
	/** It may run, on this allocation. */
	started: Allocation;
	/** A higher job took its allocation: stop what runs and wait for `started` again. */
	preempted: undefined;
	/** It ran past its walltime: stop what runs; its allocation is gone. */
	expired: undefined;
	/** The scheduler can no longer be reached, so nothing more will be told. */
	lost: undefined;
}

/** A submitted job, held by whoever submitted it until `finish`. */
export interface JobHandle extends Eventful<JobEvents> {
	readonly id: string;
	/** What it holds now; null while it waits. */
	readonly allocation: Allocation | null;
	/** Its place in line while it waits, 1 next; null once started or before it was told. */
	readonly place: number | null;
	/** Starts its walltime over, as a holder beginning another bounded step. */
	renew(): Promise<void>;
	/** Done, or no longer wanted: its allocation goes back, or it leaves the queue. */
	finish(): Promise<void>;
}

/** Where jobs are submitted: the scheduler itself, or a client of the server's. */
export interface JobSubmitter {
	/**
	 * Submits `spec`, resolving once it is in the queue; aborting `signal`
	 * finishes it. The handle tells when it may run.
	 */
	submit(spec: JobSpec, signal?: AbortSignal): Promise<JobHandle>;
}

/** `JobRequest` as it goes over the wire, durations in milliseconds. */
export interface JobRequestJson {
	resources: Record<string, Amount>;
	walltimeMs: number;
	expectedMs?: number;
}

/** `JobSpec` as it goes over the wire. */
export interface JobSpecJson extends Omit<JobSpec, "request"> {
	request: JobRequestJson;
}
