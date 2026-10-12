import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import {
	ArrowDownIcon,
	ArrowUpIcon,
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
	type Report,
	type Review,
	withAnswer,
} from "../asked";
import type { Question } from "../plan";
import { copiedLabel, useCopy } from "./card";
import {
	CardBody,
	CardShell,
	ENDINGS,
	reportText,
	toCardTop,
} from "./card-shell";
import { Markdown } from "./markdown";
import { Refusal, useRefusal } from "./refusal";
import { blockedReply } from "./unanswered";

/** What the cards in a conversation answer through. */
export interface Reply {
	/**
	 * Sends `text` as a message of its own, leaving what is typed as it is;
	 * null where nothing can be sent from the page, as to an external agent.
	 */
	send: ((text: string) => Promise<void>) | null;
	/**
	 * Where a card keeps what is written in it and not sent, under a name of
	 * its own in the conversation, so leaving and coming back loses nothing.
	 */
	drafts: {
		read(name: string): string;
		write(name: string, text: string): void;
	};
}

/** The open conversation's; none outside one, where cards only show. */
export const ReplyContext = createContext<Reply | null>(null);

/**
 * The reply the person sent to the message a card is in, or null while they
 * have yet to: what `InMessage` reads from the thread.
 */
const SentContext = createContext<string | null>(null);

/**
 * Puts the card in `children` in its message: from the person's reply to it
 * on, the card keeps that reply, which nothing changes any more.
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
 * What a card answers through while the person has yet to reply to its
 * message, and once they have, the reply they sent. Neither outside a
 * conversation.
 */
export function useCardReply(): { reply: Reply | null; sent: string | null } {
	const live = useContext(ReplyContext);
	const sent = useContext(SentContext);
	return sent === null ? { reply: live, sent: null } : { reply: null, sent };
}

/**
 * What a card keeps in the conversation's drafts under `name` while it is
 * written, dropped once `sent`; nothing is kept without a name.
 */
function useKept(
	name: string | null,
	sent: string | null,
): { read(): string; write(text: string): void } {
	const drafts = useContext(ReplyContext)?.drafts ?? null;
	// Sent, from the card or the composer: nothing is left to keep.
	useEffect(() => {
		if (sent !== null && name !== null) {
			drafts?.write(name, "");
		}
	}, [sent, name, drafts]);
	return {
		read: () => (name === null ? "" : (drafts?.read(name) ?? "")),
		write: (text) => {
			if (name !== null) {
				drafts?.write(name, text);
			}
		},
	};
}

/**
 * Focuses what `first` finds as a card comes up to be answered, which the
 * composer leaves to it, and scrolls the card to its top, unless the person
 * is typing elsewhere, as in a composer holding a draft, or is in a dialog,
 * such as the open questions'.
 */
function useArrival(
	live: boolean,
	first: () => HTMLElement | null | undefined,
): void {
	const arrive = useEffectEvent(() => {
		const typing = document.activeElement;
		if (typing?.closest('[role="dialog"]') != null) {
			return;
		}
		if (
			(typing instanceof HTMLTextAreaElement ||
				typing instanceof HTMLInputElement) &&
			typing.value !== ""
		) {
			return;
		}
		const stop = first();
		stop?.focus({ preventScroll: true });
		const card = stop?.closest<HTMLElement>("[data-card]");
		if (card != null) {
			toCardTop(card);
		}
	});
	useEffect(() => {
		if (live) {
			arrive();
		}
	}, [live]);
}

/**
 * The data a `data-questions` part carries: one message's questions, in
 * order, and the escalation they end, when they do.
 */
export interface QuestionsData {
	questions: Question[];
	escalation: Report | null;
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
function MessageQuestions({
	questions,
	escalation,
}: QuestionsData): JSX.Element {
	const message = useAuiState((state) => state.message.id);
	return (
		<QuestionCards
			questions={questions}
			escalation={escalation}
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
	escalation = null,
	draft = null,
	copy = false,
	blocked = false,
	onSent,
}: {
	questions: Question[];
	/** The escalation they end, which heads them in its place. */
	escalation?: Report | null;
	/** The name it keeps what is written under in the conversation's drafts. */
	draft?: string | null;
	/** Copy the reply rather than send it: its agent runs outside the page. */
	copy?: boolean;
	/**
	 * Numbered as in the task's `## Blocked` rather than the agent's latest
	 * report, which the reply opens by saying.
	 */
	blocked?: boolean;
	/** Once the reply is sent from it. */
	onSent?: () => void;
}): JSX.Element {
	const { reply, sent } = useCardReply();
	const live = sent === null && (copy || reply !== null);
	const kept = useKept(draft, sent);
	const [written, setWritten] = useState(() => {
		const before = kept.read();
		return {
			lines: linesFor(
				questions,
				questions.map((asked) => answerIn(before, asked)),
			),
			more: besides(before, questions),
		};
	});
	const write = (next: { lines: string; more: string }) => {
		setWritten(next);
		kept.write(replyOf(next.lines, next.more));
	};
	// What the answers are read from: what is written here, or once sent, the
	// reply that was.
	const said = sent ?? written.lines;
	const more = sent === null ? written.more : besides(sent, questions);
	const answers = questions.map((asked) => answerIn(said, asked));
	const answered = answers.filter((answer) => answer !== null).length;
	const out = replyOf(written.lines, written.more);
	const send = copy ? null : (reply?.send ?? null);
	const { copied, copy: copyOut } = useCopy();
	const { refusal, attempt } = useRefusal();
	const submit = () => {
		if (!live || out === "") {
			return;
		}
		const text = blocked ? blockedReply(out) : out;
		if (send === null) {
			copyOut(text);
		} else {
			// Sent from outside a message, nothing else drops what it kept.
			void attempt(
				send(text).then(() => {
					kept.write("");
					onSent?.();
				}),
				"Not sent",
			);
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
		// The whole question in view, not just its first stop, which the
		// browser would leave at the very foot of the thread.
		following?.focus({ preventScroll: true });
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
				{reported !== "" && (
					<div className="border-b">
						<CardBody text={reported} lead={escalation?.reason != null} />
					</div>
				)}
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
		// A screenshot under a choice keeps its own keys.
		if (
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			!(event.target as HTMLElement).hasAttribute("aria-pressed")
		) {
			return;
		}
		const buttons = [
			...event.currentTarget.querySelectorAll<HTMLButtonElement>(
				"button[aria-pressed]",
			),
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
		<li
			aria-label={`question ${number}`}
			className="group/question flex gap-3 px-4 py-4 transition-colors duration-150 focus-within:bg-muted/30"
		>
			<span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[11px] text-muted-foreground tabular-nums transition-colors duration-150 group-focus-within/question:bg-primary group-focus-within/question:text-primary-foreground">
				{number}
				{answer !== null && <span className="sr-only"> answered</span>}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-3">
				<div className="flex flex-col gap-1">
					<p className="font-medium text-sm leading-snug">
						<Markdown text={text} inline />
					</p>
					{body !== "" && (
						<Markdown
							text={body}
							className="text-[13px] text-muted-foreground leading-relaxed [&_p]:my-0"
						/>
					)}
				</div>
				{pick === "order" ? (
					<Ranking
						asked={asked}
						answer={said}
						live={live}
						onAnswer={onAnswer}
						onNext={onNext}
					/>
				) : (
					choices.length > 0 && (
						<fieldset
							aria-label={text}
							onKeyDown={keys}
							className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
						>
							<legend className="mb-1.5 text-muted-foreground text-xs">
								{pick === "any" ? "Select all that apply" : "Pick one"}
							</legend>
							{choices.map((choice, index) => {
								const on = said.picks.includes(choice.key);
								return (
									// Its body sits under it in the same frame, outside the
									// button, as a screenshot is a button of its own. Ringed on
									// any focus, not just a keyboard one, since a card that
									// comes up focuses its first choice itself.
									<div
										key={choice.key}
										className={cn(
											"group rounded-lg border transition-[background-color,border-color,box-shadow,transform] duration-150 has-[>button:active]:scale-[0.99] has-[>button:focus]:ring-3 has-[>button:focus]:ring-ring/40",
											on
												? "border-primary/60 bg-primary/[0.04] shadow-xs ring-1 ring-primary/15"
												: "border-border/70 bg-background hover:border-border hover:bg-muted/50",
										)}
									>
										<button
											type="button"
											aria-pressed={on}
											disabled={!live}
											// One stop per question for Tab; the arrows and letters
											// move within it.
											tabIndex={index === at ? 0 : -1}
											data-stop={index === at ? number : undefined}
											onFocus={() => setAt(index)}
											onClick={() => toggle(choice.key)}
											className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none disabled:cursor-default"
										>
											<span
												className={cn(
													"flex size-5 shrink-0 items-center justify-center border font-medium font-mono text-[11px] transition-colors duration-150",
													// A circle picks one, as a radio does; a square any.
													pick === "any" ? "rounded-md" : "rounded-full",
													on
														? "border-primary bg-primary text-primary-foreground"
														: "bg-muted/60 text-muted-foreground group-hover:bg-background",
												)}
											>
												{choice.key}
											</span>
											<Markdown
												text={choice.text}
												inline
												unlinked
												className="flex-1"
											/>
											{choice.chosen && <Chosen />}
											<CheckIcon
												className={cn(
													"size-4 shrink-0 text-primary transition-[opacity,transform] duration-150",
													on ? "scale-100 opacity-100" : "scale-75 opacity-0",
												)}
											/>
										</button>
										<ChoiceBody body={choice.body} />
									</div>
								);
							})}
						</fieldset>
					)
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

/**
 * What is indented under a choice, as its screenshot, lined up with its text
 * unless `inset` is off, where it already sits under the text.
 */
function ChoiceBody({
	body,
	inset = true,
}: {
	body: string;
	inset?: boolean;
}): JSX.Element | null {
	return body === "" ? null : (
		<Markdown
			text={body}
			className={cn(
				"text-[13px] text-muted-foreground leading-relaxed [&_p]:my-0",
				inset && "pr-3 pb-2 pl-11",
			)}
		/>
	);
}

/** Marks the choice the agent went with while it waits for the reply. */
function Chosen(): JSX.Element {
	return (
		<span className="shrink-0 rounded-full border px-1.5 py-px text-[11px] text-muted-foreground">
			Recommended
		</span>
	);
}

/**
 * The choices in the order an answer puts them, those it leaves out after in
 * the order they were offered: the agent's order until the person moves one.
 */
function ranked(asked: Question, answer: Answer): Question["choices"] {
	const placed = answer.picks.flatMap(
		(key) => asked.choices.find((choice) => choice.key === key) ?? [],
	);
	return [
		...placed,
		...asked.choices.filter((choice) => !placed.includes(choice)),
	];
}

/**
 * A question whose choices are put in order: each moves up or down by its
 * buttons, or with Alt and the arrows, and the answer is every choice's
 * letter in the order they end up in. "Keep this order" answers with the
 * order as it stands.
 */
function Ranking({
	asked,
	answer,
	live,
	onAnswer,
	onNext,
}: {
	asked: Question;
	answer: Answer;
	live: boolean;
	onAnswer: (answer: Answer) => void;
	onNext: () => void;
}): JSX.Element {
	const { number, text } = asked;
	const order = ranked(asked, answer);
	const answered = answer.picks.length > 0;
	const [at, setAt] = useState(0);
	const list = useRef<HTMLOListElement>(null);
	const focus = (index: number) => {
		setAt(index);
		list.current?.querySelectorAll<HTMLElement>("[data-row]")[index]?.focus();
	};
	const move = (from: number, step: number) => {
		const to = from + step;
		if (to < 0 || to >= order.length) {
			return;
		}
		const next = order.map((choice) => choice.key);
		next.splice(to, 0, ...next.splice(from, 1));
		onAnswer({ ...answer, picks: next });
		// The focus goes with the choice it was on.
		setAt(to);
		requestAnimationFrame(() => focus(to));
	};
	const keys = (event: KeyboardEvent<HTMLOListElement>) => {
		// A screenshot under a choice keeps its own keys.
		if (
			event.metaKey ||
			event.ctrlKey ||
			!(event.target as HTMLElement).hasAttribute("data-row")
		) {
			return;
		}
		const step =
			event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
		if (step !== 0) {
			event.preventDefault();
			if (event.altKey) {
				move(at, step);
			} else {
				focus((at + step + order.length) % order.length);
			}
		} else if (event.key === "Enter") {
			event.preventDefault();
			onNext();
		}
	};
	return (
		<div className="flex flex-col gap-1.5">
			<p className="text-muted-foreground text-xs">
				Put in order, first at the top
			</p>
			<ol
				ref={list}
				aria-label={text}
				onKeyDown={live ? keys : undefined}
				className="flex flex-col gap-1.5"
			>
				{order.map((choice, index) => (
					<li
						key={choice.key}
						data-row
						tabIndex={live ? (index === at ? 0 : -1) : undefined}
						data-stop={live && index === at ? number : undefined}
						onFocus={() => setAt(index)}
						className={cn(
							"flex items-center gap-3 rounded-lg border px-3 py-1.5 text-sm outline-none transition-[background-color,border-color,box-shadow] duration-150 focus:ring-3 focus:ring-ring/40",
							answered
								? "border-primary/60 bg-primary/[0.04]"
								: "border-border/70 bg-background",
						)}
					>
						<span className="w-3 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
							{index + 1}
						</span>
						<span className="flex size-5 shrink-0 items-center justify-center rounded-md border bg-muted/60 font-medium font-mono text-[11px] text-muted-foreground">
							{choice.key}
						</span>
						<span className="flex min-w-0 flex-1 flex-col">
							<Markdown text={choice.text} inline unlinked />
							<ChoiceBody body={choice.body} inset={false} />
						</span>
						{live && (
							<span className="flex shrink-0">
								<Button
									variant="ghost"
									size="icon-sm"
									tabIndex={-1}
									aria-label={`Move ${choice.key} up`}
									disabled={index === 0}
									onClick={() => move(index, -1)}
								>
									<ArrowUpIcon />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									tabIndex={-1}
									aria-label={`Move ${choice.key} down`}
									disabled={index === order.length - 1}
									onClick={() => move(index, 1)}
								>
									<ArrowDownIcon />
								</Button>
							</span>
						)}
					</li>
				))}
			</ol>
			{live && (
				<div className="flex items-center gap-3">
					<p className="flex-1 text-muted-foreground text-xs">
						<Kbd>⌥↑</Kbd> <Kbd>⌥↓</Kbd> moves
					</p>
					<Button
						variant="outline"
						size="xs"
						onClick={() =>
							onAnswer({
								...answer,
								picks: answered ? [] : order.map((choice) => choice.key),
							})
						}
					>
						{answered ? "Clear order" : "Keep this order"}
					</Button>
				</div>
			)}
		</div>
	);
}

/** What the reply to a review says to merge, as the skill asks for it. */
const MERGE = "merge";

/**
 * Renders a `data-review` part as a review panel while it is mounted in a
 * thread: apart from questions, since approving is one decision about the
 * whole task. Merge, or what to change, is sent from the panel itself.
 */
export const ReviewUI = makeAssistantDataUI<{ review: Review }>({
	name: "review",
	render: ({ data }) => (
		<InMessage>
			<MessageReview review={data.review} />
		</InMessage>
	),
});

/** The review of the message it is in, kept as a draft under that message. */
function MessageReview({ review }: { review: Review }): JSX.Element {
	const message = useAuiState((state) => state.message.id);
	return <ReviewPanel review={review} draft={`review:${message}`} />;
}

/**
 * A review answered by keyboard alone: it comes up in its changes box, where
 * Enter sends them, and Merge is a Tab away. What is written stays in the
 * panel, never the composer, until it is sent.
 */
export function ReviewPanel({
	review,
	draft = null,
}: {
	review: Review;
	/** The name it keeps what is written under in the conversation's drafts. */
	draft?: string | null;
}): JSX.Element {
	const { reply, sent } = useCardReply();
	const send = sent === null ? (reply?.send ?? null) : null;
	const kept = useKept(draft, sent);
	const [changes, setChanges] = useState(() => kept.read());
	const write = (text: string) => {
		setChanges(text);
		kept.write(text);
	};
	const asked = changes.trim();
	const { refusal, attempt } = useRefusal();
	const ask = () => {
		if (asked !== "" && send !== null) {
			void attempt(send(asked), "Not sent");
		}
	};
	const box = useRef<HTMLTextAreaElement>(null);
	useArrival(send !== null, () => box.current);
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
			{send !== null && (
				<footer className="flex flex-col gap-2.5 border-t bg-muted/20 px-4 py-3">
					<textarea
						ref={box}
						aria-label={`Changes to ${review.task}`}
						rows={1}
						value={changes}
						placeholder="Say what to change…"
						onChange={(event) => write(event.target.value)}
						onKeyDown={(event) => {
							// Enter sends, as in the composer; Shift+Enter is a new line.
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								ask();
							}
						}}
						className="field-sizing-content min-h-9 w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-border focus:border-ring focus:ring-3 focus:ring-ring/20"
					/>
					<div className="flex items-center gap-2">
						<p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
							<span>
								<Kbd>↵</Kbd> sends changes
							</span>
							{asked === "" && (
								<span>
									<Kbd>Tab</Kbd> to merge
								</span>
							)}
						</p>
						<Button
							variant="outline"
							size="sm"
							disabled={asked === ""}
							onClick={ask}
						>
							<SendHorizontalIcon data-icon="inline-start" />
							Send changes
						</Button>
						<Button
							size="sm"
							// Changes written would go unsaid: merging means none.
							disabled={asked !== ""}
							title={asked === "" ? undefined : "Clear the changes to merge"}
							onClick={() => void attempt(send(MERGE), "Not sent")}
							className="bg-success text-white hover:bg-success/90"
						>
							<GitMergeIcon data-icon="inline-start" />
							Merge
						</Button>
					</div>
					<Refusal refusal={refusal} className="text-right" />
				</footer>
			)}
		</CardShell>
	);
}
