import { availableParallelism, loadavg } from "node:os";

/** How many times the cores the one-minute load may reach before the queue holds back, unless the config says. */
export const QUEUE_LOAD_DEFAULT = 1.5;

/** The machine's load, as `queueOverloaded` reads it. */
export interface LoadReading {
	/** The one-minute load average. */
	load: number;
	cores: number;
}

/** Reads this machine's load now. */
export function readLoad(): LoadReading {
	return { load: loadavg()[0] ?? 0, cores: availableParallelism() };
}

/**
 * Whether the load is over `cap` times the cores, so the queue starts no more
 * agents; a `cap` of null never holds.
 */
export function queueOverloaded(
	cap: number | null,
	reading: LoadReading = readLoad(),
): boolean {
	return cap !== null && reading.load > cap * reading.cores;
}
