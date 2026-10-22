import type { PortLink } from "@stringsync/splates-server/ports";
import type {
	KeyHolder,
	KeyProvider,
	MachineReading,
	QueueListing,
	WorkerBudgetReport,
	WorkerKey,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import type { HeavyJobsReading } from "webappwiz/system";
import { ApiError, send, sendJson } from "./request";

/**
 * The email Cloudflare Access signed this page's visitor in with, or null
 * when the page is opened on this machine or Access is off.
 */
export async function identity(): Promise<string | null> {
	const response = await fetch("/api/identity");
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
	const response = await fetch("/api/ports");
	if (!response.ok) {
		throw new ApiError("error", `/api/ports: ${response.status}`);
	}
	return ((await response.json()) as { ports: PortLink[] }).ports;
}

/**
 * What the page shows of the machine: its reading, its heavy jobs, and the
 * agents waiting for a slot on a worker, first in line first.
 */
export type MachineStatus = MachineReading & {
	heavy: HeavyJobsReading;
	queue: QueueListing[];
	/** Where the worker budget stands; null without a `workerProvider`. */
	workerBudget?: WorkerBudgetReport | null;
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
	const response = await fetch("/api/machine");
	if (!response.ok) {
		throw new ApiError("error", `/api/machine: ${response.status}`);
	}
	return (await response.json()) as MachineStatus;
}

/** Every worker, those turned away, and the build `splates server` runs, as `splates worker list` reads them. */
export async function workerPool(): Promise<WorkerPool> {
	const response = await fetch("/api/workers");
	if (!response.ok) {
		throw new ApiError("error", `/api/workers: ${response.status}`);
	}
	return (await response.json()) as WorkerPool;
}

/** What can be set on a worker: its slots, null to go by its hello, and whether it drains. */
export interface WorkerChange {
	slots?: number | null;
	draining?: boolean;
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

/** Wakes worker `id`, asleep at home, answering the pool once its packet is sent. */
export async function wakeWorker(id: string): Promise<WorkerPool> {
	return (await send(`/api/workers/${encodeURIComponent(id)}/wake`, {
		method: "POST",
	})) as WorkerPool;
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

/** Every worker's API key, by whose and which provider's, with the providers and who may hold one. */
export interface WorkerKeysListing {
	keys: WorkerKey[];
	providers: KeyProvider[];
	holders: { workers: string[]; types: string[] };
}

/** The API keys workers hold; never a value. */
export async function workerKeys(): Promise<WorkerKeysListing> {
	const response = await fetch("/api/workers/keys");
	const body = (await response
		.json()
		.catch(() => ({}))) as WorkerKeysListing & {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/workers/keys: ${response.status}`,
		);
	}
	return body;
}

/** Keeps `value` as `provider`'s key for `holder`, over the one it held. */
export async function addWorkerKey(
	holder: KeyHolder,
	provider: string,
	value: string,
): Promise<void> {
	await sendJson("/api/workers/keys", "PUT", { provider, ...holder, value });
}

/** Deletes `provider`'s key for `holder`. */
export async function removeWorkerKey(
	holder: KeyHolder,
	provider: string,
): Promise<void> {
	await send(
		`/api/workers/keys?${new URLSearchParams({ provider, ...holder })}`,
		{ method: "DELETE" },
	);
}
