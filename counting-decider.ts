import type { Answer, Decider, Decision, Question } from "webappwiz/decide";
import { Duration } from "webappwiz/time";

/**
 * Answers every question with no opinion and counts what it was asked, so a
 * dry run tells what a real one would send without spending anything.
 */
export class CountingDecider implements Decider {
	/** Characters a real model would read, counting the state once per question. */
	characters = 0;
	requests = 0;

	async decide(
		state: unknown,
		questions: Record<string, Question>,
	): Promise<Decision> {
		this.requests++;
		const shared = JSON.stringify(state).length;
		const answers: Record<string, Answer> = {};
		for (const [id, question] of Object.entries(questions)) {
			this.characters += shared + JSON.stringify(question).length;
			answers[id] = unsure(question);
		}
		return {
			model: "counting",
			answers,
			cost: {
				latency: Duration.zero(),
				inputTokens: 0,
				outputTokens: 0,
				dollars: 0,
			},
		};
	}

	/**
	 * What a real run costs at `dollarsPerToken`, at four characters a token,
	 * erring high since the state is counted again for every question.
	 */
	dollars(dollarsPerToken: number): number {
		return (this.characters / 4) * dollarsPerToken;
	}
}

function unsure(question: Question): Answer {
	if (question.type === "noul") {
		return { type: "noul", noul: 0.5 };
	}
	const keys =
		question.type === "choice"
			? Object.keys(question.criteria)
			: question.criteria.map((_, index) => String(index));
	const even = Object.fromEntries(keys.map((key) => [key, 1 / keys.length]));
	return question.type === "choice"
		? {
				type: "choice",
				choice: keys[0] ?? "",
				probabilities: even,
				confidence: 0,
			}
		: {
				type: "score",
				score: 0,
				legend: {},
				probabilities: even,
				confidence: 0,
			};
}
