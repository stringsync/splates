import type { Answer, Decider, Decision, Question } from "webappwiz/decide";
import type { DictationDecision, EditKind } from "webappwiz/dictate";

/**
 * A {@link Decider} that asks `inner` and notes in `into` what each request
 * asked, what came back and what it cost, for the cleanup `cleanup`, so a
 * person can see why a take came out as it did.
 */
export class RecordingDecider implements Decider {
	constructor(
		private readonly inner: Decider,
		private readonly cleanup: EditKind,
		private readonly into: DictationDecision[],
	) {}

	async decide(
		state: unknown,
		questions: Record<string, Question>,
		signal?: AbortSignal,
	): Promise<Decision> {
		const decision = await this.inner.decide(state, questions, signal);
		this.into.push({
			cleanup: this.cleanup,
			model: decision.model,
			state: words(state),
			questions: Object.entries(questions).map(([id, question]) => {
				const answer = decision.answers[id];
				return {
					id,
					instructions: words(question.instructions),
					answer: answer === undefined ? "no answer" : said(answer),
				};
			}),
			latencyMs: decision.cost.latency.ms,
			inputTokens: decision.cost.inputTokens,
			outputTokens: decision.cost.outputTokens,
			dollars: decision.cost.dollars,
		});
		return decision;
	}
}

function words(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

/** An answer as a few words: a Noul's probability, a Choice's likeliest options. */
function said(answer: Answer): string {
	if (answer.type === "noul") {
		return answer.noul.toFixed(2);
	}
	if (answer.type === "score") {
		return `score ${answer.score}`;
	}
	return Object.entries(answer.probabilities)
		.sort(([, one], [, other]) => other - one)
		.slice(0, 3)
		.map(([option, probability]) => `${option} ${probability.toFixed(2)}`)
		.join(", ");
}
