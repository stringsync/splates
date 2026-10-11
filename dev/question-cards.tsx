import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import {
	CheckIcon,
	GitMergeIcon,
	MessageCircleQuestionIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	type KeyboardEvent,
	type ReactNode,
	useContext,
	useRef,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import { type Answer, answerIn, type Review, withAnswer } from "../asked";
import type { Question } from "../plan";
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
 * mounted in a thread. Picking and typing compose the reply in the composer,
 * `2. b: only on phones`, as the person would have typed it; nothing is sent
 * until they send it.
 */
export const QuestionsUI = makeAssistantDataUI<QuestionsData>({
	name: "questions",
	render: ({ data }) => (
		<InMessage>
			<QuestionCards questions={data.questions} />
		</InMessage>
	),
});

export function QuestionCards({
	questions,
}: {
	questions: Question[];
}): JSX.Element {
	const { reply, sent } = useCardReply();
	// What the answers are read from: the reply being written, or once sent,
	// the one that was.
	const said = reply?.text ?? sent;
	const panel = useRef<HTMLOListElement>(null);
	const answered = questions.filter(
		(asked) => said !== null && answerIn(said, asked) !== null,
	).length;
	// Enter in an answer box goes on to the next question's, and from the
	// last into the composer, where the reply is sent.
	const next = (number: string) => {
		const boxes = [
			...(panel.current?.querySelectorAll<HTMLTextAreaElement>(
				"textarea[data-answer]",
			) ?? []),
		];
		const following =
			boxes[boxes.findIndex((box) => box.dataset.answer === number) + 1];
		if (following === undefined) {
			reply?.focus();
			return;
		}
		following.focus();
		following.setSelectionRange(following.value.length, following.value.length);
	};
	return (
		<CardShell
			label="questions for you"
			Icon={MessageCircleQuestionIcon}
			title={`${questions.length === 1 ? "A question" : "Questions"} for you`}
			tone="info"
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
			<ol ref={panel} aria-label="questions" className="divide-y">
				{questions.map((asked) => (
					<QuestionCard
						key={asked.number}
						asked={asked}
						reply={reply}
						said={said}
						onNext={() => next(asked.number)}
					/>
				))}
			</ol>
		</CardShell>
	);
}

function QuestionCard({
	asked,
	reply,
	said: replied,
	onNext,
}: {
	asked: Question;
	/** The composer, while the reply is still being written. */
	reply: Reply | null;
	/** The reply its answer is read from, being written or sent. */
	said: string | null;
	onNext: () => void;
}): JSX.Element {
	const { number, text, body, choices, pick } = asked;
	const answer = replied === null ? null : answerIn(replied, asked);
	const said: Answer = answer ?? { picks: [], words: "" };
	const say = (next: Answer) =>
		reply?.write(withAnswer(reply.text, asked, next));
	const toggle = (key: string) => {
		const on = said.picks.includes(key);
		say({
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
				{answer === null ? (
					number
				) : (
					<CheckIcon aria-label="answered" className="size-3" strokeWidth={3} />
				)}
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
						className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
					>
						{pick === "any" && (
							<legend className="mb-1.5 text-muted-foreground text-xs">
								Pick any
							</legend>
						)}
						{choices.map((choice) => {
							const on = said.picks.includes(choice.key);
							return (
								<button
									key={choice.key}
									type="button"
									aria-pressed={on}
									disabled={reply === null}
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
				{reply !== null && (
					<textarea
						data-answer={number}
						aria-label={`Answer to ${number}`}
						rows={1}
						value={said.words}
						placeholder={
							choices.length > 0 ? "Add a note (optional)" : "Your answer"
						}
						onChange={(event) =>
							// One line per question is what the agent reads.
							say({
								...said,
								words: event.target.value.replace(/\n/g, " "),
							})
						}
						onKeyDown={enter}
						className="field-sizing-content min-h-9 w-full resize-none rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm outline-none transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-border focus:border-ring focus:bg-background focus:ring-3 focus:ring-ring/20"
					/>
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
						{merging ? (
							<CheckIcon strokeWidth={3} data-icon="inline-start" />
						) : (
							<GitMergeIcon data-icon="inline-start" />
						)}
						{merging ? "Merge on send" : "Merge"}
					</Button>
				</footer>
			)}
		</CardShell>
	);
}
