import { type Baseline, baselines } from "./baselines";
import type { Outcome } from "./outcomes";

/** How a merged task went, beside how its project's tasks went the week before. */
export interface Landed {
	outcome: Outcome;
	/** Its project's tasks over the week to its merge, itself among them; null for none. */
	baseline: Baseline | null;
}

/**
 * The last merge of `task` in `project`, held against the week up to it, so
 * the comparison reads the same however long after it is asked. Null when it
 * never merged there.
 */
export function landed(
	outcomes: Outcome[],
	project: string,
	task: string,
): Landed | null {
	const outcome = outcomes.findLast(
		(each) =>
			each.project === project && each.task === task && each.ended === "merged",
	);
	if (outcome === undefined) {
		return null;
	}
	const [baseline] = baselines(
		outcomes.filter((each) => each.project === project),
		new Date(outcome.endedAt),
	);
	return { outcome, baseline: baseline ?? null };
}
