import { Duration } from "core/time";

/** How often a target's status is asked whether a release is live. */
export const POLL = Duration.secs(10);

/** How often it is asked while the release is still early, before half of the time it is expected to take. */
export const EARLY_POLL = Duration.secs(30);

/** How long to wait before the next check, `waited` ms into a step expected to take `expected` ms: slow while a release is unlikely to be there yet. */
export function pollAfter(waited: number, expected: number): Duration {
	return waited < expected / 2 ? EARLY_POLL : POLL;
}

/** A function giving the wait before the next check, counting from now. */
export function pollSince(
	clock: { now(): number },
	expected: () => number,
): () => Duration {
	const began = clock.now();
	return () => pollAfter(clock.now() - began, expected());
}
