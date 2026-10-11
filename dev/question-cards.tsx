import { makeAssistantDataUI } from "@assistant-ui/react";
import {
	CheckIcon,
	GitMergeIcon,
	MessageCircleQuestionIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	type KeyboardEvent,
	useContext,
	useRef,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import { type Answer, answerIn, type Review, withAnswer } from "../asked";
import type { Question } from "../plan";
import { Markdown } from "./markdown";

/** The reply being written in the composer, as the cards read and write it. */
export interface Reply {
	text: string;
	write(text: string): void;
	/** Puts the cursor in the composer, at the end of what is there. */
	focus(): void;
}

/** The open conversation's composer; none outside one, where cards only show. */
export const ReplyContext = createContext<Reply | null>(null);

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
	render: ({ data }) => <QuestionCards questions={data.questions} />,
});

export function QuestionCards({
	questions,
}: {
	questions: Question[];
}): JSX.Element {
	const reply = useContext(ReplyContext);
	const panel = useRef<HTMLDivElement>(null);
	const answered = questions.filter(
		(asked) => reply !== null && answerIn(reply.text, asked) !== null,
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
		<div
			ref={panel}
			className="my-4 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs"
		>
			<header className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
				<MessageCircleQuestionIcon className="size-4 text-muted-foreground" />
				<span className="font-medium text-[13px]">
					{questions.length === 1 ? "A question" : "Questions"} for you
				</span>
				<span className="ml-auto text-muted-foreground text-xs tabular-nums">
					{answered} of {questions.length} answered
				</span>
				<span
					aria-hidden
					className="h-1 w-14 overflow-hidden rounded-full bg-border"
				>
					<span
						className="block h-full rounded-full bg-success transition-[width] duration-300 ease-out"
						style={{ width: `${(answered / questions.length) * 100}%` }}
					/>
				</span>
			</header>
			<ol aria-label="questions" className="divide-y">
				{questions.map((asked) => (
					<QuestionCard
						key={asked.number}
						asked={asked}
						reply={reply}
						onNext={() => next(asked.number)}
					/>
				))}
			</ol>
		</div>
	);
}

function QuestionCard({
	asked,
	reply,
	onNext,
}: {
	asked: Question;
	reply: Reply | null;
	onNext: () => void;
}): JSX.Element {
	const { number, text, body, choices, pick } = asked;
	const answer = reply === null ? null : answerIn(reply.text, asked);
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
	render: ({ data }) => <ReviewPanel review={data.review} />,
});

export function ReviewPanel({ review }: { review: Review }): JSX.Element {
	const reply = useContext(ReplyContext);
	const merging = reply?.text.trim().toLowerCase() === MERGE;
	// Typed into the box, "merge" stays there, so writing "merge the header
	// first" keeps its first word; the button's merge shows only on itself.
	const [typing, setTyping] = useState(false);
	const changes = merging && !typing ? "" : (reply?.text ?? "");
	return (
		<section
			aria-label={`review ${review.task}`}
			className="my-4 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs"
		>
			<header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
				<GitMergeIcon className="size-4 text-muted-foreground" />
				<span className="font-medium text-[13px]">Ready to merge</span>
				<span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-muted-foreground">
					<span className="truncate rounded-md bg-background px-1.5 py-0.5 ring-1 ring-border">
						{review.task}
					</span>
					<span aria-hidden>→</span>
					<span className="truncate rounded-md bg-background px-1.5 py-0.5 ring-1 ring-border">
						{review.base}
					</span>
				</span>
			</header>
			{review.body !== "" && (
				<Markdown
					text={review.body}
					className="px-4 py-3.5 text-sm leading-relaxed [&_img]:rounded-lg [&_img]:ring-1 [&_img]:ring-border [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
				/>
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
		</section>
	);
}
