import { freemem } from "node:os";

// Measured 2026-10-25 on 16 cores, bun 1.4.2, macOS (physical footprint):
// server workers 300 to 600 MB, so the top; a page worker 432 MB over all 225
// page files. To re-measure, read the peak in `splates dev test --workers 1`
// and `--workers <n>`, and compare. Update this when it drifts.
/** The megabytes one test worker costs, per half of the suite. */
export const WORKER_COST_MB = { server: 600, page: 450 } as const;

/** The part of free memory one agent's run may take, so a few at once leave the machine usable. */
export const AGENT_SHARE = 0.25;

/** The part a merge's gate may take: it runs alone of the premerges, and wants its 3 minutes. */
export const GATE_SHARE = 0.5;

export type WorkerHalf = keyof typeof WORKER_COST_MB;

/**
 * The workers free memory allows a run: floor(free × share / cost), never
 * below 1.
 */
export function memoryWorkers(
	freeMb: number,
	share: number,
	costMb: number,
): number {
	return Math.max(1, Math.floor((freeMb * share) / costMb));
}

/**
 * The workers a run of `half` takes: `cores` unless free memory allows
 * fewer, with `byMemory` saying so for the readout.
 */
export function budgetedWorkers({
	cores,
	half,
	gate,
	freeMb = freeMemoryMb(),
}: {
	cores: number;
	half: WorkerHalf;
	gate: boolean;
	freeMb?: number;
}): { workers: number; byMemory: boolean } {
	const allowed = memoryWorkers(
		freeMb,
		gate ? GATE_SHARE : AGENT_SHARE,
		WORKER_COST_MB[half],
	);
	return allowed < cores
		? { workers: allowed, byMemory: true }
		: { workers: cores, byMemory: false };
}

/** Free memory in megabytes. */
export function freeMemoryMb(): number {
	// macOS counts only never-used pages, so this reads low, the safe way.
	return Math.floor(freemem() / 1024 / 1024);
}
