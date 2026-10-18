import type { Outcome } from "../stats";
import type { Decision } from "./plan";

/** How many calls in `outcome` the person made: the questions put to them. */
export function madeByYou(outcome: Outcome): number {
	return decided(outcome).reduce((total, [, count]) => total + count, 0);
}

/**
 * The questions `outcome` asked, each with how many it stands for: its own
 * decisions one each, or for a line from before they were kept, its counts
 * read back as unsized questions.
 */
export function decided(
	outcome: Outcome,
): [Pick<Decision, "size" | "ended">, number][] {
	if (outcome.decisions !== undefined) {
		// Lines from when agents also kept assumptions mark those `how: "assumed"`.
		return outcome.decisions
			.filter((each) => (each as { how?: string }).how !== "assumed")
			.map((each) => [each, 1]);
	}
	const picked = outcome.picksAsked ?? 0;
	const overturned = outcome.picksOverturned ?? 0;
	const amended = outcome.picksAmended ?? 0;
	const unsized = (
		ended: Decision["ended"],
		count: number,
	): [Pick<Decision, "size" | "ended">, number] => [
		{ size: null, ended },
		Math.max(0, count),
	];
	return [
		unsized("kept", picked - overturned - amended),
		unsized("amended", amended),
		unsized("overturned", overturned),
		unsized(null, (outcome.questionsAsked ?? 0) - picked),
	].filter(([, count]) => count > 0);
}

/** Whether `outcome` kept its calls at all: lines from before any were kept say nothing of them. */
export function keptDecisions(outcome: Outcome): boolean {
	return (
		outcome.decisions !== undefined || outcome.questionsAsked !== undefined
	);
}
