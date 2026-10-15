import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import {
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	MessageCircleQuestionIcon,
	SendHorizontalIcon,
} from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { focusStop, useTouch } from "#dev/hooks/use-touch.ts";
import { cn } from "#dev/lib/utils.ts";
import type { TaskReport } from "../asked";
import type { Demo } from "../demo";
import { type Event, isEscalation } from "../events";
import type { Question } from "../plan";
import { isUpdate } from "../prompts";
import { type Answer, answerIn, besides, isEmpty, replyOf } from "../reply";
import { copiedLabel, useCopy } from "./card";
import {
	InMessage,
	textOf,
	useArrival,
	useCardReply,
	useKept,
} from "./card-reply";
import { CardBody, CardShell, ENDINGS, reportText } from "./card-shell";
import { DemoSection } from "./demo-cards";
import { Markdown } from "./markdown";
import { Sheeted, useSheeted } from "./phone-sheets";
import { QuestionCard } from "./question-card";
import { Refusal, useRefusal } from "./refusal";

/**
 * The data a `data-questions` part carries: one message's questions, in
 * order, the escalation they end, when they do, and the demo they follow,
 * which is what they ask about.
 */
export interface QuestionsData {
	questions: Question[];
	escalation: TaskReport | null;
	demo: Demo | null;
}

/**
 * The questions as a panel answered by keyboard alone: a letter picks a
 * choice, the arrows move between them, Enter goes on to the next question
 * and from "Anything else" sends, as ⌘Enter does from anywhere in it. What is
 * written stays in the panel, never the composer, until it is sent, or for
 * an agent outside the page, copied to paste into its session.
 */
export function QuestionCards({
	questions,
	escalation = null,
	demo = null,
	draft = null,
	earlier = [],
	copy = false,
	paged = false,
	onSent,
}: {
	questions: Question[];
	/** The escalation they end, which heads them in its place. */
	escalation?: TaskReport | null;
	/** The demo they ask about, shown above them. */
	demo?: Demo | null;
	/** The name it keeps what is written under in the conversation's drafts. */
	draft?: string | null;
	/**
	 * The drafts of the questions these were asked again for, newest first: it
	 * opens with the first that holds anything, while its own holds nothing.
	 */
	earlier?: string[];
	/** Copy the reply rather than send it: its agent runs outside the page. */
	copy?: boolean;
	/**
	 * Whether it shows one question at a time, going on to the next as each is
	 * answered, as in a phone's sheet, rather than all of them down the card.
	 */
	paged?: boolean;
	/** Once the reply is sent from it, or copied. */
	onSent?: () => void;
}): JSX.Element {
	const { reply, sent, askedAgain } = useCardReply();
	const live = sent === null && !askedAgain && (copy || reply !== null);
	const kept = useKept(draft, sent, earlier);
	const touch = useTouch();
	const [written, setWritten] = useState((): Written => {
		const before = kept.read();
		return {
			answers: Object.fromEntries(
				questions.flatMap((asked) => {
					const answer = answerIn(before, asked);
					return answer === null ? [] : [[asked.text, answer]];
				}),
			),
			more: besides(before, questions),
		};
	});
	// By each question's line, which stays put as others come and go.
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
	// What is written here, or once sent, what the reply that was says.
	const answers = questions.map((asked) =>
		sent === null ? writtenFor(asked) : answerIn(sent, asked),
	);
	const more = sent === null ? written.more : besides(sent, questions);
	const answered = answers.filter((answer) => answer !== null).length;
	const out = replyOf(questions, questions.map(writtenFor), written.more);
	const send = copy ? null : (reply?.send ?? null);
	const { copied, copy: copyOut } = useCopy();
	const { refusal, attempt } = useRefusal();
	const submit = () => {
		if (!live || out === "") {
			return;
		}
		if (send === null) {
			// Kept, to copy again until its agent records it.
			copyOut(out, onSent);
		} else {
			// Sent from outside a message, nothing else drops what it kept.
			void attempt(
				send(out).then(() => {
					kept.write("");
					onSent?.();
				}),
				"Not sent",
			);
		}
	};
	const panel = useRef<HTMLDivElement>(null);
	// The question shown when paged, over a footer pinned to the sheet's foot.
	const [page, setPage] = useState(0);
	const last = questions.length - 1;
	const turn = (to: number) => {
		clearTimeout(going.current);
		setPage(to);
		panel.current?.closest("[data-sheet]")?.scrollTo({ top: 0 });
	};
	// A pick on a pick-one page goes on by itself, once the pick has shown.
	const going = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(going.current), []);
	const goOn = (from: number) => {
		clearTimeout(going.current);
		going.current = setTimeout(() => {
			// Unless the person turned the page themselves meanwhile.
			setPage((now) => (now === from ? from + 1 : now));
			panel.current?.closest("[data-sheet]")?.scrollTo({ top: 0 });
		}, GO_ON_MS);
	};
	// Each question's first stop, then "Anything else": where Enter goes next.
	const stops = () => [
		...(panel.current?.querySelectorAll<HTMLElement>("[data-stop]") ?? []),
	];
	const next = (number: string) => {
		if (paged) {
			const at = questions.findIndex((asked) => asked.number === number);
			if (at < last) {
				turn(at + 1);
				return;
			}
		}
		const all = stops();
		const following =
			all[all.findIndex((stop) => stop.dataset.stop === number) + 1];
		// The whole question in view, not just its first stop, which the
		// browser would leave at the very foot of the thread.
		focusStop(following, { preventScroll: true });
		following?.closest("li, footer")?.scrollIntoView({ block: "nearest" });
		if (following instanceof HTMLTextAreaElement) {
			following.setSelectionRange(
				following.value.length,
				following.value.length,
			);
		}
	};
	useArrival(live, () =>
		panel.current?.querySelector<HTMLElement>("[data-stop]"),
	);
	// Ending an escalation, they are its card: headed as it, what it says first.
	const reported = escalation === null ? "" : reportText(escalation);
	return (
		<CardShell
			{...(escalation === null
				? {
						label: "questions for you",
						Icon: MessageCircleQuestionIcon,
						title: `${questions.length === 1 ? "A question" : "Questions"} for you`,
						tone: "info" as const,
					}
				: {
						label: `escalated ${escalation.task}`,
						...ENDINGS.escalated,
						task: escalation.task,
					})}
			// Asked again below, it is answered there.
			folded={sent !== null || askedAgain}
			// Each question marks itself while it has the focus.
			ringed={false}
			// Paged, the dots in its footer say it, so a narrow header never wraps.
			aside={
				paged ? undefined : (
					<span className="flex items-center gap-2">
						<span className="text-muted-foreground text-xs tabular-nums">
							{answered} of {questions.length} answered
						</span>
						<span
							aria-hidden
							className="block h-1 w-14 overflow-hidden rounded-full bg-border"
						>
							<span
								className="block h-full rounded-full bg-success transition-[width] duration-300 ease-out"
								style={{ width: `${(answered / questions.length) * 100}%` }}
							/>
						</span>
					</span>
				)
			}
		>
			<div
				ref={panel}
				// Paged, it fills its sheet, so its footer sits at the foot.
				className={cn(paged && "flex flex-1 flex-col")}
				onKeyDownCapture={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						event.stopPropagation();
						submit();
					}
				}}
			>
				{reported !== "" && (!paged || page === 0) && (
					<div className="border-b">
						<CardBody text={reported} lead={escalation?.reason != null} />
					</div>
				)}
				{demo !== null && (!paged || page === 0) && (
					<DemoSection
						demo={demo}
						kept={draft === null ? null : `${draft}:demo`}
					/>
				)}
				<ol aria-label="questions" className="divide-y">
					{questions.map((asked, at) =>
						paged && at !== page ? null : (
							<QuestionCard
								key={asked.number}
								asked={asked}
								answer={answers[at] ?? null}
								live={live}
								onAnswer={(answer) => {
									const picked = answer.picks.some(
										(key) => !(writtenFor(asked)?.picks.includes(key) ?? false),
									);
									if (paged && asked.pick === "one" && picked && at < last) {
										goOn(at);
									}
									write({
										...written,
										answers: isEmpty(answer)
											? Object.fromEntries(
													Object.entries(written.answers).filter(
														([text]) => text !== asked.text,
													),
												)
											: { ...written.answers, [asked.text]: answer },
									});
								}}
								onNext={() => next(asked.number)}
							/>
						),
					)}
				</ol>
				{live ? (
					<footer
						// Paged in a sheet, it stays at the sheet's foot, as a composer does.
						data-pinned={paged || undefined}
						className={cn(
							"flex flex-col gap-2.5 border-t px-4 py-3",
							paged
								? "sticky bottom-0 z-10 mt-auto bg-background"
								: "bg-muted/20",
						)}
					>
						<textarea
							data-stop="more"
							aria-label="Anything else"
							rows={1}
							value={written.more}
							placeholder="Anything else?"
							onChange={(event) =>
								write({ ...written, more: event.target.value })
							}
							onKeyDown={(event) => {
								// Enter sends, as in the composer; Shift+Enter is a new line.
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									submit();
								}
							}}
							className="field-sizing-content min-h-9 w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-border focus:border-ring focus:ring-3 focus:ring-ring/20"
						/>
						<div className="flex items-center gap-3">
							{paged && questions.length === 1 ? (
								<span className="flex-1" />
							) : paged ? (
								<nav
									aria-label="questions"
									className="-ml-3 flex flex-1 items-center"
								>
									<Button
										variant="ghost"
										size="icon"
										aria-label="Previous question"
										className="size-11"
										disabled={page === 0}
										onClick={() => turn(page - 1)}
									>
										<ChevronLeftIcon />
									</Button>
									{/* A dot per question, filled once answered, the one shown ringed. */}
									{questions.map((asked, at) => (
										<button
											key={asked.number}
											type="button"
											aria-label={`Question ${at + 1} of ${questions.length}${answers[at] === null ? "" : ", answered"}`}
											aria-current={at === page ? "step" : undefined}
											onClick={() => turn(at)}
											className="flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
										>
											<span
												className={cn(
													"block size-2.5 rounded-full transition-colors duration-150",
													answers[at] === null ? "bg-border" : "bg-success",
													at === page &&
														"ring-2 ring-foreground/60 ring-offset-2 ring-offset-background",
												)}
											/>
										</button>
									))}
									<Button
										variant="ghost"
										size="icon"
										aria-label="Next question"
										className="size-11"
										disabled={page === last}
										onClick={() => turn(page + 1)}
									>
										<ChevronRightIcon />
									</Button>
								</nav>
							) : (
								<p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
									{!touch && (
										<>
											<span>
												<Kbd>↵</Kbd> next
											</span>
											<span>
												<Kbd>⌘↵</Kbd> {send === null ? "copies" : "sends"}
											</span>
										</>
									)}
								</p>
							)}
							<Button
								size="sm"
								disabled={out === ""}
								title={copied.state === "failed" ? copied.error : undefined}
								onClick={submit}
								className="pointer-coarse:h-10 pointer-coarse:px-3"
							>
								{send !== null ? (
									<SendHorizontalIcon data-icon="inline-start" />
								) : copied.state === "copied" ? (
									<CheckIcon data-icon="inline-start" />
								) : (
									<CopyIcon data-icon="inline-start" />
								)}
								<span aria-live="polite">
									{send === null ? copiedLabel(copied, "Copy reply") : "Send"}
								</span>
							</Button>
						</div>
						<Refusal refusal={refusal} className="text-right" />
					</footer>
				) : (
					more !== "" && (
						// What else the person said, as it was sent.
						<footer className="flex items-start gap-2 border-t bg-muted/20 px-4 py-3 text-sm">
							<span className="shrink-0 text-muted-foreground">Also</span>
							<Markdown
								text={more}
								className="min-w-0 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
							/>
						</footer>
					)
				)}
			</div>
		</CardShell>
	);
}

/** How long a pick shows before a paged panel goes on from it. */
const GO_ON_MS = 300;

/**
 * What the questions `message` asks keep what is written under: by its first
 * question too, as a message can ask more than one list.
 */
function draftName(message: string, questions: Question[]): string {
	return `questions:${message}:${questions[0]?.text ?? ""}`;
}

/** The questions an escalation it records asks; null for any other event. */
function escalatedQuestions(event: Event): Question[] | null {
	return isEscalation(event) && !event.review ? event.questions : null;
}

/** What the panel holds before it is sent: answers by question line, and the rest. */
interface Written {
	answers: Record<string, Answer>;
	more: string;
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

/** The questions of the message it is in, kept as a draft under that message. */
export function MessageQuestions({
	questions,
	escalation,
	demo,
}: QuestionsData): JSX.Element {
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
			{...(escalation === null
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
				demo={demo}
				draft={draftName(message, questions)}
				earlier={before === "" ? [] : before.split("\n")}
				paged={sheeted}
			/>
		</Sheeted>
	);
}
