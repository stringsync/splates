import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import { ListChecksIcon, MessageCircleQuestionIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import {
	type Assumed,
	assumedIn,
	type Proposal,
	type TaskReport,
} from "../asked";
import type { Demo } from "../demo";
import { type Event, isEscalation } from "../events";
import type { Question } from "../plan";
import { isUpdate } from "../prompts";
import { Board } from "./board";
import { InMessage, textOf } from "./card-reply";
import { ENDINGS } from "./card-shell";
import { Sheeted, useSheeted } from "./phone-sheets";
import { QuestionCards } from "./question-cards";

/**
 * The data a `data-questions` part carries: one message's questions, in
 * order, the escalation they end or the proposal they rest under, when they
 * do, the demo they follow, which is what they ask about, and the calls the
 * agent says it made without asking, with the task it made them in.
 */
export interface QuestionsData {
	questions: Question[];
	escalation: TaskReport | null;
	proposal: Proposal | null;
	demo: Demo | null;
	assumed: Assumed[];
	task: string | null;
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
 * The questions of the message it is in, kept as a draft under that message,
 * and the calls it assumed, as its task's `ARBOR.md` writes them.
 */
export function MessageQuestions({
	questions,
	escalation,
	proposal,
	demo,
	assumed,
	task,
}: QuestionsData): JSX.Element {
	const plan = useContext(Board).plans.get(task ?? "") ?? "";
	const message = useAuiState((state) => state.message.id);
	// The drafts of the questions asked before these since the person last
	// replied, newest first, which these take over, as when arbor told the
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
	const sheeted = useSheeted();
	const count = `${questions.length} ${questions.length === 1 ? "question" : "questions"}`;
	return (
		<Sheeted
			{...(proposal !== null
				? {
						title: `Questions: ${proposal.subject}`,
						Icon: MessageCircleQuestionIcon,
						tone: "info" as const,
					}
				: escalation === null && questions.length === 0
					? { title: "Assumed", Icon: ListChecksIcon, tone: "neutral" as const }
					: escalation === null
						? {
								title: `${count} for you`,
								Icon: MessageCircleQuestionIcon,
								tone: "info" as const,
							}
						: {
								title: `${count} for you`,
								Icon: ENDINGS.escalated.Icon,
								tone: ENDINGS.escalated.tone,
							})}
		>
			<QuestionCards
				questions={questions}
				escalation={escalation}
				proposal={proposal}
				demo={demo}
				assumed={assumedIn(plan, assumed)}
				draft={draftName(message, questions)}
				earlier={before === "" ? [] : before.split("\n")}
				paged={sheeted}
			/>
		</Sheeted>
	);
}

/**
 * What the questions `message` asks keep what is written under: by its first
 * question too, as a message can ask more than one list.
 */
function draftName(message: string, questions: Question[]): string {
	return `questions:${message}:${questions[0]?.text ?? "proposal"}`;
}

/** The questions an escalation it records asks; null for any other event. */
function escalatedQuestions(event: Event): Question[] | null {
	return isEscalation(event) && !event.review ? event.questions : null;
}
