import type { Classification } from "./classify";
import type { AutoPickDecision } from "./decide";

// Browser-safe: types alone, which the page reads off a task's record.

/**
 * The last Auto pick for a task, kept on its record: whom it started and
 * why, and what the judge said of the task's words and attachment metadata, so a pick of the same
 * words again needs no judge.
 */
export interface AutoPicked extends AutoPickDecision {
	/** When it was decided, as an ISO time. */
	at: string;
	/**
	 * What the judge said of the task, by the `classificationKey` of the words
	 * it read, including breadth, clarity, stakes and verification; absent when it said nothing, as with no judge or one that failed.
	 */
	classified?: { key: string; classification: Classification };
}
