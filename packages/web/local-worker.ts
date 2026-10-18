import type {
	WorkerListing,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import { updateWorker, type WorkerChange } from "./api";

// Whether this Mac runs agents as a worker. Today its worker is always
// listed and turned off by draining, since it cannot be removed; once it can
// (#95), off removes it and on brings it back, and only this file changes.

/** This machine's own worker, or null while it is none. */
export function localWorker(pool: WorkerPool): WorkerListing | null {
	return pool.workers.find((worker) => worker.kind === "local") ?? null;
}

/** Whether this machine takes new agents as a worker. */
export function localWorkerOn(pool: WorkerPool): boolean {
	const local = localWorker(pool);
	return local !== null && !local.draining;
}

/** What turning this machine on or off as a worker sets on its listing, before the server answers. */
export function localChange(on: boolean): WorkerChange {
	return { draining: !on };
}

/**
 * Turns this machine on or off as a worker, answering the pool as it then
 * stands. Off lets the agents on it run to their end.
 */
export function turnLocalWorker(
	pool: WorkerPool,
	on: boolean,
): Promise<WorkerPool> {
	const local = localWorker(pool);
	if (local === null) {
		return Promise.reject(new Error("this machine has no worker to turn on"));
	}
	return updateWorker(local.id, localChange(on));
}
