import type { Outcome } from "./outcomes";
import type { Decision } from "./plan";

/**
 * Who made `decision`: the person, for one put to them or an assumption
 * they challenged, which took their attention either way; otherwise the
 * agent, whose assumption stood without them.
 */
export function whose(
	decision: Pick<Decision, "how" | "ended">,
): "decidedByYou" | "decidedByAgents" {
	return decision.how === "asked" || decision.ended === "challenged"
		? "decidedByYou"
		: "decidedByAgents";
}

/** How many calls in `outcome` `who` made. */
export function madeBy(
	outcome: Outcome,
	who: ReturnType<typeof whose>,
): number {
	return decided(outcome).reduce(
		(total, [decision, count]) => total + (whose(decision) === who ? count : 0),
		0,
	);
}

/**
 * The calls `outcome` made, each with how many it stands for: its own
 * decisions one each, or for a line from before they were kept, its counts
 * read back as unsized calls.
 */
export function decided(
	outcome: Outcome,
): [Pick<Decision, "size" | "how" | "ended">, number][] {
	if (outcome.decisions !== undefined) {
		return outcome.decisions.map((each) => [each, 1]);
	}
	const picked = outcome.picksAsked ?? 0;
	const overturned = outcome.picksOverturned ?? 0;
	const amended = outcome.picksAmended ?? 0;
	const challenged = outcome.assumptionsChallenged ?? 0;
	const unsized = (
		how: Decision["how"],
		ended: Decision["ended"],
		count: number,
	): [Pick<Decision, "size" | "how" | "ended">, number] => [
		{ size: null, how, ended },
		Math.max(0, count),
	];
	return [
		unsized("asked", "kept", picked - overturned - amended),
		unsized("asked", "amended", amended),
		unsized("asked", "overturned", overturned),
		// `questionsAsked` counts challenged assumptions, which moved there.
		unsized("asked", null, (outcome.questionsAsked ?? 0) - picked - challenged),
		unsized("assumed", "kept", (outcome.assumptionsMade ?? 0) - challenged),
		unsized("assumed", "challenged", challenged),
	].filter(([, count]) => count > 0);
}

/** Whether `outcome` kept its calls at all: lines from before any were kept say nothing of them. */
export function keptDecisions(outcome: Outcome): boolean {
	return (
		outcome.decisions !== undefined ||
		outcome.questionsAsked !== undefined ||
		outcome.assumptionsMade !== undefined
	);
}
