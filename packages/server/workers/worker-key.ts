import type { WorkerRecords } from "./records";

/** The header a joined worker shows its key in, as `Bearer <id>:<key>`. */
export const WORKER_KEY_HEADER = "authorization";

/** `Bearer <id>:<key>`, as a joined worker shows its key. */
export function workerAuthorization(id: string, key: string): string {
	return `Bearer ${id}:${key}`;
}

/** The worker `request`'s key proves it to be; null for none, or a key no worker joined with. */
export function keyedWorker(
	request: Request,
	records: WorkerRecords,
): string | null {
	const shown = request.headers.get(WORKER_KEY_HEADER) ?? "";
	const match = /^Bearer (.+):([^:]+)$/.exec(shown);
	if (match === null) {
		return null;
	}
	const [, id = "", key = ""] = match;
	// One being removed still connects, to finish the agents it drains.
	return records.verify(id, key) ? id : null;
}
