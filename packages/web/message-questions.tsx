import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import type { PlanCard, Question, TaskReport } from "@splates/server/plans";
import { isUpdate } from "@splates/server/plans/browser";
import type { Event } from "@splates/server/records";
import { isEscalation } from "@splates/server/records/browser";
import { type JSX, useContext } from "react";
import { InMessage, textOf } from "./card-reply";
import { Sheeted, useSheeted } from "./phone-sheets";
import { QuestionCards } from "./question-cards";
import { questionHeading } from "./question-heading";
import { decisionsFor, TrustContext } from "./trust-widget";

/**
 * The data a `data-questions` part carries: one message's questions, in
 * order, the escalation they end, when they do, and the task they are asked
 * in.
 */
export interface QuestionsData {
	questions: Question[];
	escalation: TaskReport | null;
	task: string | null;
	/** The plan they decide, which heads them; null or unset for none. */
	plan?: PlanCard | null;
}

/**
 * Renders a `data-questions` part as the questions' panel while it is
 * mounted in a thread, answered and sent from the panel itself.
 */
export const QuestionsUI = makeAssistantDataUI<QuestionsData>({
	name: "questions",
	render: ({ data }) => (
		<InMessage>
			<MessageQuestions {...data} />
		</InMessage>
	),
});

/**
 * The questions of the message it is in, kept as a draft under that message.
 */
export function MessageQuestions({
	questions,
	escalation,
	plan = null,
}: QuestionsData): JSX.Element {
	const message = useAuiState((state) => state.message.id);
	// The drafts of the questions asked before these since the person last
	// replied, newest first, which these take over, as when splates told the
	// agent of a task's end meanwhile and it asked them again.
	const before = useAuiState((state) => {
		const names: string[] = [];
		for (const earlier of state.thread.messages
			.slice(0, state.message.index)
			.toReversed()) {
			if (earlier.role === "user" && !isUpdate(textOf(earlier))) {
				break;
			}
			for (const part of earlier.content) {
				const asked =
					part.type !== "data"
						? null
						: part.name === "questions"
							? (part.data as QuestionsData).questions
							: part.name === "event"
								? escalatedQuestions((part.data as { event: Event }).event)
								: null;
				if (asked !== null && asked.length > 0) {
					names.push(draftName(earlier.id, asked));
				}
			}
		}
		return names.join("\n");
	});
	const stamp = useAuiState((state) => state.message.metadata.custom.at);
	const sheeted = useSheeted();
	const thread = useContext(TrustContext);
	const trust = decisionsFor(
		thread,
		message,
		questions.map((each) => each.text),
	);
	const count = `${questions.length} ${questions.length === 1 ? "question" : "questions"}`;
	return (
		<Sheeted {...questionHeading(questions.length, escalation, count, plan)}>
			<QuestionCards
				questions={questions}
				escalation={escalation}
				plan={plan}
				planAt={typeof stamp === "string" ? stamp : null}
				draft={draftName(message, questions)}
				earlier={before === "" ? [] : before.split("\n")}
				paged={sheeted}
				stepped
				trust={trust}
				agent={thread.agent}
			/>
		</Sheeted>
	);
}

/**
 * What the questions `message` asks keep what is written under: by its first
 * question too, as a message can ask more than one list.
 */
function draftName(message: string, questions: Question[]): string {
	return `questions:${message}:${questions[0]?.text ?? "questions"}`;
}

/** The questions an escalation it records asks; null for any other event. */
function escalatedQuestions(event: Event): Question[] | null {
	return isEscalation(event) && !event.review ? event.questions : null;
}
