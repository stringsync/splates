/** What the worker the supervisor starts beside the server is known by. */
export const LOCAL_WORKER = "local";

/**
 * The worker started beside this machine's own on `build`, to take new
 * agents while its own drains to be brought to that build.
 */
export function handoffWorker(build: string): string {
	return `${LOCAL_WORKER}-${build}`;
}

/** Whether `id` is one of this machine's workers: its own or one taking over while it updates. */
export function isLocalWorker(id: string): boolean {
	return id === LOCAL_WORKER || isHandoffWorker(id);
}

/** Whether `id` is a worker started to take new agents while this machine's own updates. */
export function isHandoffWorker(id: string): boolean {
	return id.startsWith(`${LOCAL_WORKER}-`);
}
