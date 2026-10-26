import type { PortLink } from "@stringsync/splates-server/ports";
import type {
	MachineReading,
	QueueListing,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import { ApiError, answered, scoped, send, sendJson } from "./request";

/**
 * The email Cloudflare Access signed this page's visitor in with, or null
 * when the page is opened on this machine or Access is off.
 */
export async function identity(): Promise<string | null> {
	const response = await answered("/api/identity");
	if (!response.ok) {
		throw new ApiError("error", `/api/identity: ${response.status}`);
	}
	return ((await response.json()) as { email: string | null }).email;
}

/**
 * Each port a task serves now, with its link through the ports host, if one
 * is saved, and on the machine `splates server` runs on.
 */
export async function taskPorts(): Promise<PortLink[]> {
	const response = await answered("/api/ports");
	if (!response.ok) {
		throw new ApiError("error", `/api/ports: ${response.status}`);
	}
	return ((await response.json()) as { ports: PortLink[] }).ports;
}

/**
 * What the page shows of the machine: its reading, and the
 * agents waiting for a slot on a worker, first in line first.
 */
export type MachineStatus = MachineReading & {
	queue: QueueListing[];
};

/** Moves the agent of conversation `id` to `position` in the queue for a worker slot, from 1. */
export async function moveQueued(id: string, position: number): Promise<void> {
	await send(`/api/queue/${encodeURIComponent(id)}/position`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ position }),
	});
}

/** How hard the machine `splates server` runs on is working right now. */
export async function machine(): Promise<MachineStatus> {
	const response = await answered("/api/machine");
	if (!response.ok) {
		throw new ApiError("error", `/api/machine: ${response.status}`);
	}
	return (await response.json()) as MachineStatus;
}

/** Every worker, those turned away, and the build `splates server` runs, as `splates worker list` reads them. */
export async function workerPool(): Promise<WorkerPool> {
	// Scoped, so the pool says whether this project's jobs fit a runner.
	const response = await answered(scoped("/api/workers"));
	if (!response.ok) {
		throw new ApiError("error", `/api/workers: ${response.status}`);
	}
	return (await response.json()) as WorkerPool;
}

/**
 * What can be set on a worker: whether it drains, and, on this machine's
 * own, whether what splates starts on its own is paused.
 */
export interface WorkerChange {
	draining?: boolean;
	paused?: boolean;
}

/** Sets `change` on worker `id`, answering the pool as it then stands. */
export async function updateWorker(
	id: string,
	change: WorkerChange,
): Promise<WorkerPool> {
	return (await sendJson(
		`/api/workers/${encodeURIComponent(id)}`,
		"PUT",
		change,
	)) as WorkerPool;
}

/**
 * Removes worker `id`, at once if nothing runs on it or `force`, which ends
 * what does; otherwise it drains and goes once `running` ends.
 */
export async function removeWorker(
	id: string,
	force: boolean,
): Promise<{ id: string; removed: boolean; running: string[] }> {
	return (await send(
		`/api/workers/${encodeURIComponent(id)}${force ? "?force" : ""}`,
		{ method: "DELETE" },
	)) as { id: string; removed: boolean; running: string[] };
}
