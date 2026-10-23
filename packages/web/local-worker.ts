import type {
	WorkerListing,
	WorkerPool,
} from "@stringsync/splates-server/workers";

// This machine's own worker, which runs every agent. One turned off before
// the Workers page went is turned back on by the Queue page's Resume.

/** What this machine's own worker is known by. */
export const LOCAL = "local";

/** This machine's own worker, or null while it is none. */
export function localWorker(pool: WorkerPool): WorkerListing | null {
	return pool.workers.find((worker) => worker.kind === "local") ?? null;
}

/** Whether this machine takes new agents as a worker. */
export function localWorkerOn(pool: WorkerPool): boolean {
	const local = localWorker(pool);
	return local !== null && (!local.draining || local.updating);
}
