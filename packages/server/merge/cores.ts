/**
 * The test workers a merge's gate may run: the cores the last minute's load
 * left idle, up to all but two, and never fewer than half. The gate runs
 * alone of the premerges, but beside every agent: on 16 cores the suite took
 * 58.8s at 8 workers, 50.6s at 11 and 48.5s at 14 on a quiet machine, while
 * 14 at load 32 timed out and 8 did not (2026-10-23).
 */
export function gateCores(cores: number, load: number): number {
	const half = Math.max(1, Math.floor(cores / 2));
	return Math.min(
		Math.max(half, cores - 2),
		Math.max(half, Math.floor(cores - load)),
	);
}
