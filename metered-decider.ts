import type { Decider, Decision, Question } from "webappwiz/decide";

/** A decider that adds up what its decisions cost. */
export class MeteredDecider implements Decider {
	dollars = 0;
	requests = 0;

	constructor(private readonly inner: Decider) {}

	async decide(
		state: unknown,
		questions: Record<string, Question>,
		signal?: AbortSignal,
	): Promise<Decision> {
		const decision = await this.inner.decide(state, questions, signal);
		this.requests++;
		this.dollars += decision.cost.dollars;
		return decision;
	}
}
