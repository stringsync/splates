import type { Question } from "@splates/server/plans";
import {
	type Answer,
	answerIn,
	besides,
	replyOf,
	takenOf,
} from "@splates/server/plans/browser";
import { useState } from "react";
import { useKept } from "./card-reply";

interface Written {
	answers: Record<string, Answer>;
	more: string;
}

/**
 * Holds and persists draft answers and the "Anything else?" note for a
 * `QuestionCards` panel until the reply is sent.
 */
export function useQuestionDrafts({
	questions,
	draft,
	sent,
	earlier,
}: {
	questions: Question[];
	draft: string | null;
	sent: string | null;
	earlier: string[];
}) {
	const kept = useKept(draft, sent, earlier);
	const chosen = (asked: Question): Answer | null =>
		asked.choices.some((choice) => choice.chosen) ? takenOf(asked) : null;
	const [written, setWritten] = useState((): Written => {
		const before = kept.read();
		return {
			answers: Object.fromEntries(
				questions.flatMap((asked) => {
					const answer = answerIn(before, asked) ?? chosen(asked);
					return answer === null ? [] : [[asked.text, answer]];
				}),
			),
			more: besides(before, questions),
		};
	});
	const writtenFor = (asked: Question) => written.answers[asked.text] ?? null;
	const write = (next: Written) => {
		setWritten(next);
		kept.write(
			replyOf(
				questions,
				questions.map((asked) => next.answers[asked.text] ?? null),
				next.more,
			),
		);
	};
	const setAnswer = (asked: Question, next: Answer | null) =>
		write({
			...written,
			answers:
				next === null
					? Object.fromEntries(
							Object.entries(written.answers).filter(
								([text]) => text !== asked.text,
							),
						)
					: { ...written.answers, [asked.text]: next },
		});
	const answers = questions.map((asked) =>
		sent === null ? writtenFor(asked) : answerIn(sent, asked),
	);
	const more = sent === null ? written.more : besides(sent, questions);
	return {
		kept,
		written,
		write,
		writtenFor,
		setAnswer,
		answers,
		more,
	};
}
