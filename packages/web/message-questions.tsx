import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import type { PlanTrusted } from "@splates/server/conversations";
import type { PlanCard, Question, TaskReport } from "@splates/server/plans";
import { isUpdate } from "@splates/server/plans/browser";
import type { Event } from "@splates/server/records";
import { isEscalation } from "@splates/server/records/browser";
import { bandOf } from "@splates/server/trust/browser";
import { type JSX, useContext } from "react";
import { InMessage, textOf } from "./card-reply";
import { Sheeted, useSheeted } from "./phone-sheets";
import { QuestionCards } from "./question-cards";
import { questionHeading } from "./question-heading";
import { decisionsFor, type ThreadTrust, TrustContext } from "./trust-widget";

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
	/**
	 * The trust the agent went ahead on the plan with, unapproved, as the
	 * server kept it when the turn ended; null or unset for none, or while
	 * the turn runs.
	 */
	trusted?: PlanTrusted | null;
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
	trusted = null,
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
	// Gone ahead on: anything after the plan, in its message or a later one,
	// shows the agent carried on without the person's word.
	const followed = useAuiState((state) => {
		const content = state.message.content;
		const at = content.findLastIndex(
			(part) => part.type === "data" && part.name === "questions",
		);
		return (
			plan !== null &&
			(at < content.length - 1 ||
				state.message.index < state.thread.messages.length - 1)
		);
	});
	const running = useAuiState(
		(state) => state.message.status?.type === "running",
	);
	const wentAhead = followed
		? (trusted ?? (running ? trustedNow(thread) : null))
		: null;
	const count = `${questions.length} ${questions.length === 1 ? "question" : "questions"}`;
	const cards = (paged: boolean) => (
		<QuestionCards
			questions={questions}
			escalation={escalation}
			plan={plan}
			planAt={typeof stamp === "string" ? stamp : null}
			draft={draftName(message, questions)}
			earlier={before === "" ? [] : before.split("\n")}
			paged={paged}
			stepped
			trust={trust}
			agent={thread.agent}
			wentAhead={wentAhead}
		/>
	);
	// Gone ahead on trust, it waits on nobody: its line stays in the thread,
	// with no sheet or bar above the composer, on a phone too.
	if (wentAhead !== null) {
		return cards(false);
	}
	return (
		<Sheeted {...questionHeading(questions.length, escalation, count, plan)}>
			{cards(sheeted)}
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

/**
 * The trust the agent has now, when it lets it go ahead on a plan unapproved
 * (ask-and-go or above, with trusted decisions on): for a turn still
 * running, before the server keeps its own as the turn ends.
 */
function trustedNow(thread: ThreadTrust): PlanTrusted | null {
	const read = thread.trust;
	if (read === null) {
		return null;
	}
	const band = bandOf(read.entry, read.enabled !== false);
	return band === "ask-and-wait" ? null : { band, score: read.entry.score };
}
