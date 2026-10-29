import type { Cascade } from "./cascade";
import { cascadeId } from "./history";

/** Read a past ship with an id and stage list, including ships saved by older versions. */
export function upgraded(cascade: Cascade): Cascade {
	return {
		...cascade,
		id: cascade.id ?? cascadeId(cascade.from, cascade.started),
		steps: cascade.steps.map((step) => ({
			...step,
			stages: step.stages ?? [],
		})),
	};
}
