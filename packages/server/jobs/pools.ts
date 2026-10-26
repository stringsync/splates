import type { MachineSensors } from "../workers/load";

/** Cores left to the person, the server and git, outside any job. */
export const CPU_RESERVE = 2;

/** The share of memory held back from jobs. */
export const MEMORY_RESERVE_SHARE = 0.15;

/** The pool of one item: the tree a whole test suite runs in. */
export const SUITE = "suite";

/**
 * The machine's resource pools, each a quantity, as a worker's are in
 * HyperQueue: what each holds, and what the machine measures in use, which
 * counts the person's own work without scheduling it.
 */
export interface Pools {
	/** Each pool's whole size. */
	capacity(): Promise<Record<string, number>>;
	/** What the machine measures in use of each pool it can measure, jobs included. */
	used(): Promise<Record<string, number>>;
}

/**
 * This machine's pools: `cpus` is the cores less `CPU_RESERVE`, `mem` the
 * megabytes less `MEMORY_RESERVE_SHARE`, and `suite` one item. In use: the
 * one-minute load average for cpus, memory not free for mem.
 */
export class MachinePools implements Pools {
	constructor(
		private readonly sensors: Pick<
			MachineSensors,
			"cpus" | "loadavg" | "totalmem" | "freemem"
		>,
	) {}

	async capacity(): Promise<Record<string, number>> {
		return {
			cpus: Math.max(1, this.sensors.cpus().length - CPU_RESERVE),
			mem: Math.floor(
				megabytes(this.sensors.totalmem()) * (1 - MEMORY_RESERVE_SHARE),
			),
			[SUITE]: 1,
		};
	}

	async used(): Promise<Record<string, number>> {
		return {
			cpus: this.sensors.loadavg()[0] ?? 0,
			mem: megabytes(this.sensors.totalmem() - this.sensors.freemem()),
		};
	}
}

function megabytes(bytes: number): number {
	return Math.floor(bytes / (1024 * 1024));
}
