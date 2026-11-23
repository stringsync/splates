import type { PlanCard, Question } from "@splates/server/plans";
import { type Answer, isEmpty } from "@splates/server/plans/browser";
import { type JSX, useState } from "react";
import { usePlanPage } from "./artifact-open";
import type { BoxFiles } from "./box-files";
import { PlanAnswer } from "./plan-answer";
import type { PlanComment } from "./plan-comments";
import type { PlanMarkups } from "./plan-markups";
import { PlanLightbox, PlanTile, usePlanName } from "./plan-tile";
import { QuestionCard } from "./question-card";

/**
 * Manages the inline HTML plan tile and lightbox state for `QuestionCards`.
 */
export function useQuestionPlan({
	questions,
	planned,
	answers,
	live,
	decisionAsked,
	files,
	markups,
	comments,
	onReference,
	onComments,
	onAnswer,
}: {
	questions: Question[];
	planned: PlanCard | null;
	answers: (Answer | null)[];
	live: boolean;
	decisionAsked: Question | undefined;
	files: BoxFiles | null;
	markups: PlanMarkups;
	comments: PlanComment[];
	onReference: (reference: string) => void;
	onComments: (next: PlanComment[]) => void;
	onAnswer: (asked: Question, next: Answer | null) => void;
}): {
	tileOf: (asked: Question) => JSX.Element | null;
	lightbox: JSX.Element;
} {
	const [planQuestion, setPlanQuestion] = useState<string | null>(null);
	const page = usePlanPage(
		questions.find((asked) => typeof asked.plan === "string")?.plan ?? null,
	);
	const name = usePlanName();
	const tileOf = (asked: Question) =>
		asked.plan === undefined ||
		(asked.plan === null && planned !== null) ? null : (
			<PlanTile
				name={name}
				page={typeof asked.plan === "string" ? page : null}
				onOpen={() => setPlanQuestion(asked.number)}
			/>
		);
	const lightbox = (
		<PlanLightbox
			page={page}
			name={name}
			open={planQuestion !== null && live}
			onClose={() => setPlanQuestion(null)}
			onReference={onReference}
			markups={markups}
			comments={comments}
			onComments={onComments}
			questions={
				<PlanAnswer
					key={planQuestion}
					question={
						questions.find((asked) => asked.number === planQuestion)?.text ?? ""
					}
					onBack={() => setPlanQuestion(null)}
				>
					<ol aria-label="questions" className="divide-y">
						{questions
							.filter((asked) => asked.number === planQuestion)
							.map((asked) => (
								<QuestionCard
									key={asked.number}
									asked={asked}
									headed={false}
									decided={asked === decisionAsked}
									answer={answers[questions.indexOf(asked)] ?? null}
									live={live}
									files={files?.of(asked.text) ?? null}
									onAnswer={(next) =>
										onAnswer(asked, isEmpty(next) ? null : next)
									}
									onNext={() => {}}
								/>
							))}
					</ol>
				</PlanAnswer>
			}
		/>
	);
	return { tileOf, lightbox };
}
