import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import {
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	MessageCircleQuestionIcon,
	SendHorizontalIcon,
} from "lucide-react";
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { focusStop, raises, useTouch } from "#dev/hooks/use-touch.ts";
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
	 * Whether it shows one question a screen, as a phone's form does, with
	 * "Anything else" and Send on a last screen of their own, rather than all
	 * of them down the card. Only while it can be answered.
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
	// Answered, every question shows, as on any other card.
	const paging = paged && live;
	// The screen shown when paging, over a footer pinned to the sheet's foot:
	// a question's index, or `end` for "Anything else" and Send.
	const [page, setPage] = useState(0);
	const end = questions.length;
	// Whether the page turned to takes the focus, and raises the keyboard
	// even on a touch screen, as when Enter turned it from a field; null when
	// the focus stays where it is, as on the button that turned it.
	const landing = useRef<{ typing: boolean } | null>(null);
	const turn = (to: number, land: { typing: boolean } | null = null) => {
		clearTimeout(going.current);
		landing.current = land;
		setPage(to);
		panel.current?.closest("[data-sheet]")?.scrollTo({ top: 0 });
	};
	// A pick on a pick-one page goes on by itself, once the pick has shown.
	const going = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(going.current), []);
	const goOn = (from: number) => {
		clearTimeout(going.current);
		going.current = setTimeout(() => {
			// The choice picked goes with its page, so the next takes the focus.
			landing.current = { typing: false };
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
		if (paging) {
			const at = questions.findIndex((asked) => asked.number === number);
			turn(at + 1, { typing: raises(document.activeElement) });
			return;
		}
		const all = stops();
		const following =
			all[all.findIndex((stop) => stop.dataset.stop === number) + 1];
		// The whole question in view, not just its first stop, which the
		// browser would leave at the very foot of the thread.
		focusStop(following, { preventScroll: true });
		following?.closest("li, footer")?.scrollIntoView({ block: "nearest" });
		toEnd(following);
	};
	// The page turned to, its question's first stop; the sheet keeps it in view.
	// biome-ignore lint/correctness/useExhaustiveDependencies: each turn is a page to land on
	useLayoutEffect(() => {
		const land = landing.current;
		landing.current = null;
		if (land === null) {
			return;
		}
		const stop = panel.current?.querySelector<HTMLElement>("[data-stop]");
		if (land.typing) {
			stop?.focus();
		} else {
			focusStop(stop);
		}
		toEnd(stop);
	}, [page]);
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
			// Paging, its footer says it, so a narrow header never wraps.
			aside={
				paging ? undefined : (
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
				// Paging, it fills its sheet, so its footer sits at the foot.
				className={cn(paging && "flex flex-1 flex-col")}
				onKeyDownCapture={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						event.stopPropagation();
						submit();
					}
				}}
			>
				{reported !== "" && (!paging || page === 0) && (
					<div className="border-b">
						<CardBody text={reported} lead={escalation?.reason != null} />
					</div>
				)}
				{demo !== null && (!paging || page === 0) && (
					<DemoSection
						demo={demo}
						kept={draft === null ? null : `${draft}:demo`}
					/>
				)}
				{paging && page < end && questions.length > 1 && (
					<p className="px-5 pt-5 font-medium text-muted-foreground text-sm tabular-nums">
						Question {page + 1} of {questions.length}
					</p>
				)}
				{(!paging || page < end) && (
					<ol aria-label="questions" className="divide-y">
						{questions.map((asked, at) =>
							paging && at !== page ? null : (
								<QuestionCard
									key={asked.number}
									asked={asked}
									answer={answers[at] ?? null}
									live={live}
									roomy={paging}
									onAnswer={(answer) => {
										const picked = answer.picks.some(
											(key) =>
												!(writtenFor(asked)?.picks.includes(key) ?? false),
										);
										if (paging && asked.pick === "one" && picked) {
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
				)}
				{paging && page === end && (
					<section
						aria-label="anything else"
						className="flex flex-col gap-5 px-5 py-5"
					>
						<label className="flex flex-col gap-3">
							<span className="font-semibold text-lg leading-snug">
								Anything else?
							</span>
							<textarea
								data-stop="more"
								aria-label="Anything else"
								rows={4}
								value={written.more}
								placeholder="Optional"
								onChange={(event) =>
									write({ ...written, more: event.target.value })
								}
								className="field-sizing-content min-h-28 w-full resize-none rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-base outline-none transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 focus:border-ring focus:bg-background focus:ring-3 focus:ring-ring/20"
							/>
						</label>
						{/* What is answered, a tap from going back to change it. */}
						<ol aria-label="your answers" className="flex flex-col gap-2">
							{questions.map((asked, at) => (
								<li key={asked.number}>
									<button
										type="button"
										onClick={() => turn(at)}
										className="flex min-h-12 w-full items-center gap-3 rounded-xl border bg-card px-4 py-2 text-left active:bg-muted"
									>
										<span className="min-w-0 flex-1 truncate text-sm">
											<Markdown text={asked.text} inline unlinked />
										</span>
										{answers[at] === null ? (
											<span className="shrink-0 text-muted-foreground text-sm">
												Not answered
											</span>
										) : (
											<CheckIcon
												aria-label="answered"
												className="size-5 shrink-0 text-success"
											/>
										)}
										<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
									</button>
								</li>
							))}
						</ol>
					</section>
				)}
				{paging ? (
					<footer
						// It stays at the sheet's foot, as a composer does.
						data-pinned
						className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2 border-t bg-background px-4 py-3"
					>
						<div className="flex items-center gap-3">
							{page > 0 && (
								<Button
									variant="outline"
									className="h-11 px-4 text-base"
									onClick={() => turn(page - 1)}
								>
									<ChevronLeftIcon data-icon="inline-start" />
									Back
								</Button>
							)}
							{page < end ? (
								<Button
									className="h-11 flex-1 text-base"
									onClick={() => turn(page + 1)}
								>
									Next
									<ChevronRightIcon data-icon="inline-end" />
								</Button>
							) : (
								<Button
									className="h-11 flex-1 text-base"
									disabled={out === ""}
									onClick={submit}
								>
									<SendHorizontalIcon data-icon="inline-start" />
									Send
								</Button>
							)}
						</div>
						<Refusal refusal={refusal} className="text-right" />
					</footer>
				) : live ? (
					<footer className="flex flex-col gap-2.5 border-t bg-muted/20 px-4 py-3">
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
							className="field-sizing-content min-h-9 pointer-coarse:min-h-11 w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm pointer-coarse:text-base outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-border focus:border-ring focus:ring-3 focus:ring-ring/20"
						/>
						<div className="flex items-center gap-3">
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

/** Puts the caret at the end of what `stop` holds, when it is a field. */
function toEnd(stop: HTMLElement | null | undefined): void {
	if (stop instanceof HTMLTextAreaElement) {
		stop.setSelectionRange(stop.value.length, stop.value.length);
	}
}

/** How long a pick shows before a paging panel goes on from it. */
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
