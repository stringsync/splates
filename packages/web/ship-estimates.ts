import type { RunState } from "@splates/server/ship";
import { useEffect, useState } from "react";
import { shipRuns } from "./api/ship";

/** How many of a target's last runs its typical step times come from. */
export const ESTIMATED_FROM = 20;

/** The median milliseconds of each step of each target, keyed by `typicalKey`. */
export type ShipEstimates = ReadonlyMap<string, number>;

export function typicalKey(target: string, step: string): string {
	return `${target}\n${step}`;
}

/**
 * How long each step usually takes: the median of the last
 * `ESTIMATED_FROM` runs of a target that finished it, `runs` newest first.
 * A skipped step took no time worth expecting, and one never timed has none.
 */
export function shipEstimates(
	runs: readonly RunState[],
	skip?: string,
): ShipEstimates {
	const took = new Map<string, number[]>();
	const seen = new Map<string, number>();
	for (const run of runs) {
		if (run.id === skip || run.status !== "done") {
			continue;
		}
		for (const target of run.targets) {
			const count = seen.get(target.name) ?? 0;
			if (count >= ESTIMATED_FROM) {
				continue;
			}
			seen.set(target.name, count + 1);
			for (const step of target.steps) {
				if (
					step.status === "done" &&
					step.started !== undefined &&
					step.ended !== undefined
				) {
					const key = typicalKey(target.name, step.id);
					took.set(key, [...(took.get(key) ?? []), step.ended - step.started]);
				}
			}
		}
	}
	return new Map(
		[...took].map(([key, list]) => {
			const sorted = [...list].sort((low, high) => low - high);
			const mid = Math.floor(sorted.length / 2);
			const median =
				sorted.length % 2 === 1
					? (sorted[mid] ?? 0)
					: ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
			return [key, Math.round(median)];
		}),
	);
}

/** The typical step times from the kept runs, empty until they are read or when they cannot be. */
export function useShipEstimates(skip: string): ShipEstimates {
	const [estimates, setEstimates] = useState<ShipEstimates>(new Map());
	useEffect(() => {
		let current = true;
		shipRuns().then(
			(runs) => current && setEstimates(shipEstimates(runs, skip)),
			() => {},
		);
		return () => {
			current = false;
		};
	}, [skip]);
	return estimates;
}
