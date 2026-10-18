import type {
	WorkerListing,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import { removeWorker, updateWorker } from "./api";

// Whether this Mac runs agents as a worker. Off removes its worker, which
// then drains and leaves the pool once its agents end, keeping this Mac
// coordinator only across restarts; on adds it back.

/** What this machine's own worker is known by. */
const LOCAL = "local";

/** This machine's own worker, or null while it is none. */
export function localWorker(pool: WorkerPool): WorkerListing | null {
	return pool.workers.find((worker) => worker.kind === "local") ?? null;
}

/** Whether this machine takes new agents as a worker. */
export function localWorkerOn(pool: WorkerPool): boolean {
	const local = localWorker(pool);
	return local !== null && !local.draining;
}

/**
 * `pool` as turning this machine on or off as a worker leaves it, before
 * the server answers: off drops its worker, or drains it while agents run
 * there; on lists it again, taking new agents.
 */
export function localTurned(pool: WorkerPool, on: boolean): WorkerPool {
	const local = localWorker(pool);
	if (local === null) {
		return on ? { ...pool, workers: [added(pool), ...pool.workers] } : pool;
	}
	const turned: WorkerListing | null = on
		? { ...local, draining: false, removing: false }
		: local.slots.used === 0
			? null
			: { ...local, draining: true, removing: true };
	return {
		...pool,
		workers: pool.workers.flatMap((worker) =>
			worker !== local ? [worker] : turned === null ? [] : [turned],
		),
	};
}

/** This machine's worker as the page shows it once added back, until the server lists it. */
function added(pool: WorkerPool): WorkerListing {
	return {
		id: LOCAL,
		kind: "local",
		platform: null,
		host: null,
		build: pool.build,
		protocol: null,
		slots: { used: 0, total: null },
		health: "connected",
		draining: false,
		removing: false,
		updating: false,
		lastHeard: null,
		wokenAt: null,
		tasks: [],
		dollarsPerHour: 0,
		keys: [],
	};
}

/**
 * Turns this machine on or off as a worker. Off lets the agents on it run
 * to their end before its worker leaves the pool.
 */
export async function turnLocalWorker(on: boolean): Promise<void> {
	if (on) {
		await updateWorker(LOCAL, { draining: false });
	} else {
		await removeWorker(LOCAL, false);
	}
}
