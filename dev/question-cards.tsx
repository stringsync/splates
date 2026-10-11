import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import {
	CheckIcon,
	CopyIcon,
	GitMergeIcon,
	MessageCircleQuestionIcon,
	SendHorizontalIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	type KeyboardEvent,
	type ReactNode,
	useContext,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { cn } from "#dev/lib/utils.ts";
import {
	type Answer,
	answerIn,
	besides,
	type Review,
	withAnswer,
} from "../asked";
import type { Question } from "../plan";
import { copiedLabel, useCopy } from "./card";
import { CardBody, CardShell } from "./card-shell";
import { Markdown } from "./markdown";

/** The reply being written in the composer, as the cards read and write it. */
export interface Reply {
	text: string;
	write(text: string): void;
	/** Puts the cursor in the composer, at the end of what is there. */
	focus(): void;
	/**
	 * Sends `text` as a message of its own, leaving what is typed as it is;
	 * null where nothing can be sent from the page, as to an external agent.
	 */
	send: ((text: string) => void) | null;
	/**
	 * Where a card keeps what is written in it and not sent, under a name of
	 * its own in the conversation, so leaving and coming back loses nothing.
	 */
	drafts: {
		read(name: string): string;
		write(name: string, text: string): void;
	};
}

/** The open conversation's composer; none outside one, where cards only show. */
export const ReplyContext = createContext<Reply | null>(null);

/**
 * The reply the person sent to the message a card is in, or null while they
 * have yet to: what `InMessage` reads from the thread.
 */
const SentContext = createContext<string | null>(null);

/**
 * Puts the card in `children` in its message: from the person's reply to it
 * on, the card keeps that reply rather than following the composer.
 */
export function InMessage({ children }: { children: ReactNode }): JSX.Element {
	const sent = useAuiState((state) => {
		const next = state.thread.messages[state.message.index + 1];
		return next?.role === "user"
			? next.content
					.map((part) => (part.type === "text" ? part.text : ""))
					.join("")
			: null;
	});
	return <SentContext value={sent}>{children}</SentContext>;
}

/**
 * What a card answers through: the composer while the person has yet to
 * reply to its message, and once they have, the reply they sent, which
 * nothing writes to any more. Neither outside a conversation.
 */
export function useCardReply(): { reply: Reply | null; sent: string | null } {
	const live = useContext(ReplyContext);
	const sent = useContext(SentContext);
	return sent === null ? { reply: live, sent: null } : { reply: null, sent };
}

/** The data a `data-questions` part carries: one message's questions, in order. */
export interface QuestionsData {
	questions: Question[];
}

/**
 * Renders a `data-questions` part as the questions' panel while it is
 * mounted in a thread, answered and sent from the panel itself.
 */
export const QuestionsUI = makeAssistantDataUI<QuestionsData>({
	name: "questions",
	render: ({ data }) => (
		<InMessage>
			<MessageQuestions questions={data.questions} />
		</InMessage>
	),
});

/** The questions of the message it is in, kept as a draft under that message. */
function MessageQuestions({ questions }: QuestionsData): JSX.Element {
	const message = useAuiState((state) => state.message.id);
	return (
		<QuestionCards
			questions={questions}
			// Its first question too, as a message can ask more than one list.
			draft={`questions:${message}:${questions[0]?.text ?? ""}`}
		/>
	);
}

const UNANSWERED: Answer = { picks: [], words: "" };

/** The reply lines for `answers`, as the arbor skill reads a reply. */
function linesFor(questions: Question[], answers: (Answer | null)[]): string {
	return questions.reduce(
		(text, asked, at) => withAnswer(text, asked, answers[at] ?? UNANSWERED),
		"",
	);
}

/** The answers' lines, then anything else after a blank line. */
function replyOf(lines: string, more: string): string {
	return [lines, more.trim()].filter((each) => each !== "").join("\n\n");
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
	draft = null,
	copy = false,
}: {
	questions: Question[];
	/** The name it keeps what is written under in the conversation's drafts. */
	draft?: string | null;
	/** Copy the reply rather than send it: its agent runs outside the page. */
	copy?: boolean;
}): JSX.Element {
	const { reply, sent } = useCardReply();
	const drafts = useContext(ReplyContext)?.drafts ?? null;
	const live = sent === null && (copy || reply !== null);
	const [written, setWritten] = useState(() => {
		const kept = draft === null ? "" : (drafts?.read(draft) ?? "");
		return {
			lines: linesFor(
				questions,
				questions.map((asked) => answerIn(kept, asked)),
			),
			more: besides(kept, questions),
		};
	});
	const write = (next: { lines: string; more: string }) => {
		setWritten(next);
		if (draft !== null) {
			drafts?.write(draft, replyOf(next.lines, next.more));
		}
	};
	// Sent, from here or the composer: nothing is left to keep.
	useEffect(() => {
		if (sent !== null && draft !== null) {
			drafts?.write(draft, "");
		}
	}, [sent, draft, drafts]);
	// What the answers are read from: what is written here, or once sent, the
	// reply that was.
	const said = sent ?? written.lines;
	const more = sent === null ? written.more : besides(sent, questions);
	const answers = questions.map((asked) => answerIn(said, asked));
	const answered = answers.filter((answer) => answer !== null).length;
	const out = replyOf(written.lines, written.more);
	const send = copy ? null : (reply?.send ?? null);
	const { copied, copy: copyOut } = useCopy();
	const submit = () => {
		if (!live || out === "") {
			return;
		}
		if (send === null) {
			copyOut(out);
		} else {
			send(out);
		}
	};
	const panel = useRef<HTMLDivElement>(null);
	// Each question's first stop, then "Anything else": where Enter goes next.
	const stops = () => [
		...(panel.current?.querySelectorAll<HTMLElement>("[data-stop]") ?? []),
	];
	const next = (number: string) => {
		const all = stops();
		const following =
			all[all.findIndex((stop) => stop.dataset.stop === number) + 1];
		following?.focus();
		if (following instanceof HTMLTextAreaElement) {
			following.setSelectionRange(
				following.value.length,
				following.value.length,
			);
		}
	};
	// Ready to answer as it comes up, which the composer leaves to it, unless
	// a draft waits there.
	const arrive = useEffectEvent(() => {
		if (reply !== null && reply.text !== "") {
			reply.focus();
			return;
		}
		panel.current
			?.querySelector<HTMLElement>("[data-stop]")
			?.focus({ preventScroll: true });
	});
	useEffect(() => {
		if (live) {
			arrive();
		}
	}, [live]);
	return (
		<CardShell
			label="questions for you"
			Icon={MessageCircleQuestionIcon}
			title={`${questions.length === 1 ? "A question" : "Questions"} for you`}
			tone="info"
			folded={sent !== null}
			aside={
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
			}
		>
			<div
				ref={panel}
				onKeyDownCapture={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						event.stopPropagation();
						submit();
					}
				}}
			>
				<ol aria-label="questions" className="divide-y">
					{questions.map((asked, at) => (
						<QuestionCard
							key={asked.number}
							asked={asked}
							answer={answers[at] ?? null}
							live={live}
							onAnswer={(answer) =>
								write({
									...written,
									lines: withAnswer(written.lines, asked, answer),
								})
							}
							onNext={() => next(asked.number)}
						/>
					))}
				</ol>
				{live ? (
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
							className="field-sizing-content min-h-9 w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-border focus:border-ring focus:ring-3 focus:ring-ring/20"
						/>
						<div className="flex items-center gap-3">
							<p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
								<span>
									<Kbd>a</Kbd> picks
								</span>
								<span>
									<Kbd>↵</Kbd> next
								</span>
								<span>
									<Kbd>⌘↵</Kbd> {send === null ? "copies" : "sends"}
								</span>
							</p>
							<Button
								size="sm"
								disabled={out === ""}
								title={copied.state === "failed" ? copied.error : undefined}
								onClick={submit}
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

function QuestionCard({
	asked,
	answer,
	live,
	onAnswer,
	onNext,
}: {
	asked: Question;
	/** Its answer, being written or sent; null while it has none. */
	answer: Answer | null;
	/** Whether it can still be answered. */
	live: boolean;
	onAnswer: (answer: Answer) => void;
	onNext: () => void;
}): JSX.Element {
	const { number, text, body, choices, pick } = asked;
	const said: Answer = answer ?? UNANSWERED;
	// The choice the arrows move from, and Tab lands on: the first picked.
	const [at, setAt] = useState(() =>
		Math.max(
			0,
			choices.findIndex((choice) => said.picks.includes(choice.key)),
		),
	);
	const toggle = (key: string) => {
		const on = said.picks.includes(key);
		onAnswer({
			...said,
			picks:
				pick === "any"
					? on
						? said.picks.filter((each) => each !== key)
						: [...said.picks, key].sort()
					: on
						? []
						: [key],
		});
	};
	const keys = (event: KeyboardEvent<HTMLFieldSetElement>) => {
		if (event.metaKey || event.ctrlKey || event.altKey) {
			return;
		}
		const buttons = [
			...event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
		];
		const to = (index: number) => {
			setAt(index);
			buttons[index]?.focus();
		};
		const lettered = choices.findIndex(
			(choice) => choice.key === event.key.toLowerCase(),
		);
		if (lettered !== -1) {
			event.preventDefault();
			toggle(choices[lettered]?.key as string);
			to(lettered);
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			to((at + step + choices.length) % choices.length);
		} else if (event.key === "Enter") {
			// Space picks the choice in focus; Enter moves on.
			event.preventDefault();
			onNext();
		}
	};
	const enter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		// One line per question is what the agent reads, so no Enter makes a
		// new line; with Shift it does nothing.
		if (event.key === "Enter") {
			event.preventDefault();
			if (!event.shiftKey) {
				onNext();
			}
		}
	};
	return (
		<li aria-label={`question ${number}`} className="flex gap-3 px-4 py-4">
			<span
				className={cn(
					"mt-px flex size-5 shrink-0 items-center justify-center rounded-full font-semibold text-[11px] tabular-nums transition-colors duration-200",
					answer === null
						? "bg-muted text-muted-foreground"
						: "bg-success text-white",
				)}
			>
				{/* The number stays once answered, to answer it by: the fill says so. */}
				{number}
				{answer !== null && <span className="sr-only"> answered</span>}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-3">
				<div className="flex flex-col gap-1">
					<p className="font-medium text-sm leading-snug">{text}</p>
					{body !== "" && (
						<Markdown
							text={body}
							className="text-[13px] text-muted-foreground leading-relaxed [&_p]:my-0"
						/>
					)}
				</div>
				{choices.length > 0 && (
					<fieldset
						aria-label={text}
						onKeyDown={keys}
						className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
					>
						{pick === "any" && (
							<legend className="mb-1.5 text-muted-foreground text-xs">
								Pick any
							</legend>
						)}
						{choices.map((choice, index) => {
							const on = said.picks.includes(choice.key);
							return (
								<button
									key={choice.key}
									type="button"
									aria-pressed={on}
									disabled={!live}
									// One stop per question for Tab; the arrows and letters move
									// within it.
									tabIndex={index === at ? 0 : -1}
									data-stop={index === at ? number : undefined}
									onFocus={() => setAt(index)}
									onClick={() => toggle(choice.key)}
									className={cn(
										"group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.99] disabled:cursor-default",
										on
											? "border-primary/60 bg-primary/[0.04] shadow-xs ring-1 ring-primary/15"
											: "border-border/70 bg-background hover:border-border hover:bg-muted/50",
									)}
								>
									<span
										className={cn(
											"flex size-5 shrink-0 items-center justify-center rounded-md border font-medium font-mono text-[11px] transition-colors duration-150",
											on
												? "border-primary bg-primary text-primary-foreground"
												: "bg-muted/60 text-muted-foreground group-hover:bg-background",
										)}
									>
										{choice.key}
									</span>
									<span className="min-w-0 flex-1">{choice.text}</span>
									<CheckIcon
										className={cn(
											"size-4 shrink-0 text-primary transition-[opacity,transform] duration-150",
											on ? "scale-100 opacity-100" : "scale-75 opacity-0",
										)}
									/>
								</button>
							);
						})}
					</fieldset>
				)}
				{live ? (
					<textarea
						data-stop={choices.length === 0 ? number : undefined}
						aria-label={`Answer to ${number}`}
						rows={1}
						value={said.words}
						placeholder={
							choices.length > 0 ? "Add a note (optional)" : "Your answer"
						}
						onChange={(event) =>
							// One line per question is what the agent reads.
							onAnswer({
								...said,
								words: event.target.value.replace(/\n/g, " "),
							})
						}
						onKeyDown={enter}
						className="field-sizing-content min-h-9 w-full resize-none rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm outline-none transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-border focus:border-ring focus:bg-background focus:ring-3 focus:ring-ring/20"
					/>
				) : (
					said.words.trim() !== "" && <p className="text-sm">{said.words}</p>
				)}
			</div>
		</li>
	);
}

/** What the reply to a review says to merge, as the skill asks for it. */
const MERGE = "merge";

/**
 * Renders a `data-review` part as a review panel while it is mounted in a
 * thread: apart from questions, since approving is one decision about the
 * whole task. Merge, or what to change, is written into the composer, and
 * sent only when the person sends it.
 */
export const ReviewUI = makeAssistantDataUI<{ review: Review }>({
	name: "review",
	render: ({ data }) => (
		<InMessage>
			<ReviewPanel review={data.review} />
		</InMessage>
	),
});

export function ReviewPanel({ review }: { review: Review }): JSX.Element {
	const { reply, sent } = useCardReply();
	const merging = reply?.text.trim().toLowerCase() === MERGE;
	// Typed into the box, "merge" stays there, so writing "merge the header
	// first" keeps its first word; the button's merge shows only on itself.
	const [typing, setTyping] = useState(false);
	const changes = merging && !typing ? "" : (reply?.text ?? "");
	const approved = sent?.trim().toLowerCase() === MERGE;
	return (
		<CardShell
			label={`review ${review.task}`}
			Icon={GitMergeIcon}
			title="Ready to merge"
			task={review.task}
			base={review.base}
			folded={sent !== null}
			aside={
				sent === null ? undefined : (
					<span className="text-muted-foreground text-xs">
						{approved ? "Merge approved" : "Changes asked"}
					</span>
				)
			}
		>
			{review.body !== "" && <CardBody text={review.body} />}
			{sent !== null && (
				// What the person replied, as it was sent: the card keeps it.
				<footer className="flex items-start gap-2 border-t bg-muted/20 px-4 py-3 text-sm">
					{approved ? (
						<>
							<CheckIcon
								className="mt-0.5 size-4 text-success"
								strokeWidth={3}
							/>
							<span>Merge approved</span>
						</>
					) : (
						<>
							<span className="shrink-0 text-muted-foreground">Asked for</span>
							<Markdown
								text={sent}
								className="min-w-0 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
							/>
						</>
					)}
				</footer>
			)}
			{reply !== null && (
				<footer className="flex flex-col gap-2.5 border-t bg-muted/20 px-4 py-3 sm:flex-row sm:items-start">
					<textarea
						aria-label={`Changes to ${review.task}`}
						rows={1}
						value={changes}
						placeholder="Say what to change…"
						onChange={(event) => reply.write(event.target.value)}
						onFocus={() => setTyping(true)}
						onBlur={() => setTyping(false)}
						className="field-sizing-content min-h-9 w-full flex-1 resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-border focus:border-ring focus:ring-3 focus:ring-ring/20"
					/>
					<Button
						aria-pressed={merging}
						onClick={() => {
							reply.write(merging ? "" : MERGE);
							reply.focus();
						}}
						className={cn(
							"h-9 shrink-0 gap-1.5 px-3.5 transition-colors",
							merging && "bg-success text-white hover:bg-success/90",
						)}
					>
						{/* Both labels hold their place, so the button is as wide either
						    way and the box beside it does not shift when it is pressed. */}
						<span className="grid *:col-start-1 *:row-start-1 *:flex *:items-center *:justify-center *:gap-1.5">
							<span
								aria-hidden={merging}
								className={cn(merging && "invisible")}
							>
								<GitMergeIcon data-icon="inline-start" />
								Merge
							</span>
							<span
								aria-hidden={!merging}
								className={cn(!merging && "invisible")}
							>
								<CheckIcon strokeWidth={3} data-icon="inline-start" />
								Merge on send
							</span>
						</span>
					</Button>
				</footer>
			)}
		</CardShell>
	);
}
