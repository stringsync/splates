import type {
	Demo,
	Proposal,
	Question,
	TaskReport,
} from "@stringsync/splates-server/plans";
import {
	type Answer,
	APPROVE,
	answerIn,
	besides,
	changes,
	isEmpty,
	replyOf,
	takenOf,
} from "@stringsync/splates-server/plans/browser";
import { useReactive, useResource } from "@webappwiz/react";
import {
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	MessageSquarePlusIcon,
	SendHorizontalIcon,
} from "lucide-react";
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { focusStop, raises, useTouch } from "#web/hooks/use-touch.ts";
import { cn } from "#web/lib/utils.ts";
import { AnythingElsePage } from "./anything-else-page";
import { caretToEnd } from "./box-editor";
import { BoxFiles, MORE } from "./box-files";
import { CardBox, useBoxTaking, useCardDictationTurn } from "./card-box";
import { useArrival, useCardReply, useKept } from "./card-reply";
import { CardBody, CardShell, reportText } from "./card-shell";
import { DemoSection } from "./demo-cards";
import { useEnterWhileTaking } from "./enter-while-taking";
import { Markdown } from "./markdown";
import { QuestionCard } from "./question-card";
import { questionHeading } from "./question-heading";
import { questionOutcome } from "./question-outcome";
import { Refusal, useRefusal } from "./refusal";
import { SplatesEvent } from "./splates-event";

/**
 * The panel a thread's questions are answered in, by keyboard alone. Questions
 * with a `(chosen)` choice come answered with it; under a proposal, Approve
 * approves it once every question is answered, and picking another choice or
 * writing anything else sends a reply instead. What is written stays in the
 * panel until it is sent.
 */
export function QuestionCards({
	questions,
	escalation = null,
	proposal = null,
	demo = null,
	draft = null,
	earlier = [],
	paged = false,
	answer = null,
	onSent,
}: {
	questions: Question[];
	/** The escalation they end, which heads them in its place. */
	escalation?: TaskReport | null;
	/** The proposal they rest under, which heads them in its place. */
	proposal?: Proposal | null;
	/** The demo they ask about, shown above them. */
	demo?: Demo | null;
	/** The name it keeps what is written under in the conversation's drafts. */
	draft?: string | null;
	/**
	 * The drafts of the questions these were asked again for, newest first: it
	 * opens with the first that holds anything, while its own holds nothing.
	 */
	earlier?: string[];
	/**
	 * Whether it shows one question a screen, as a phone's form does, with
	 * Send on the last and a button there that opens "Anything else" on a
	 * screen of its own, rather than all of them down the card. Only while it
	 * can be answered.
	 */
	paged?: boolean;
	/**
	 * Answers in place of a reply, as for a form its agent asks through ACP:
	 * each question's answer, in order. Nothing else is asked for beside them.
	 */
	answer?: ((answers: (Answer | null)[]) => Promise<void>) | null;
	/** Once the reply is sent from it. */
	onSent?: () => void;
}): JSX.Element {
	const { reply, sent, askedAgain } = useCardReply();
	// Answered, or asked again below, it is history: a line of splates's,
	// as an approved review is. Show opens it again.
	const [shown, setShown] = useState(false);
	const live =
		sent === null && !askedAgain && (answer !== null || reply !== null);
	const kept = useKept(draft, sent, earlier);
	const touch = useTouch();
	// What the agent chose for `asked`, which it comes answered with.
	const chosen = (asked: Question): Answer | null =>
		asked.choices.some((choice) => choice.chosen) ? takenOf(asked) : null;
	// What a sent reply leaves unsaid of `asked` still answers it: under a
	// proposal, with what the agent chose; otherwise, nothing.
	const unsaid = (asked: Question): Answer | null =>
		proposal === null ? null : chosen(asked);
	// What a reply says of `answer`: under a proposal, nothing of one that
	// leaves what the agent chose.
	const said = (asked: Question, answer: Answer | null): Answer | null =>
		proposal === null || answer === null || changes(asked, answer)
			? answer
			: null;
	const [written, setWritten] = useState((): Written => {
		const before = kept.read();
		return {
			answers: Object.fromEntries(
				questions.flatMap((asked) => {
					const answer = answerIn(before, asked) ?? chosen(asked);
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
				questions.map((asked) => said(asked, next.answers[asked.text] ?? null)),
				next.more,
			),
		);
	};
	// Sets what is written to `asked`, dropping it once it says nothing.
	const setAnswer = (asked: Question, next: Answer | null) =>
		write({
			...written,
			answers:
				next === null
					? Object.fromEntries(
							Object.entries(written.answers).filter(
								([text]) => text !== asked.text,
							),
						)
					: { ...written.answers, [asked.text]: next },
		});
	// What is written here, or once sent, what the reply that was says.
	const answers = questions.map((asked) =>
		sent === null
			? writtenFor(asked)
			: (answerIn(sent, asked) ?? unsaid(asked)),
	);
	const more = sent === null ? written.more : besides(sent, questions);
	const answered = answers.filter((answer) => answer !== null).length;
	const send = answer !== null ? null : (reply?.send ?? null);
	// What is attached to each box, where the reply can carry files.
	const boxFiles = useResource(() => new BoxFiles(), []);
	const files = send === null ? null : boxFiles;
	const attached = useReactive(boxFiles, (each) => each.any, ["changed"]);
	const saidOf = () => questions.map((asked) => said(asked, writtenFor(asked)));
	// Every one answered, and nothing the agent chose changed,
	// sending approves the proposal; anything changed is a reply to it.
	const approving =
		proposal !== null &&
		answered === questions.length &&
		!questions.some(
			(asked) =>
				unsaid(asked) !== null && said(asked, writtenFor(asked)) !== null,
		) &&
		written.more.trim() === "" &&
		!attached;
	const out = replyOf(questions, saidOf(), written.more);
	const empty = !approving && out === "" && !attached;
	const { refusal, attempt } = useRefusal();
	const submit = () => {
		if (!live || empty) {
			return;
		}
		const approved = (text: string) =>
			!approving ? text : text === "" ? APPROVE : `${APPROVE}\n\n${text}`;
		if (answer !== null) {
			void attempt(
				answer(saidOf()).then(() => {
					kept.write("");
					onSent?.();
				}),
				"Not answered",
			);
		} else if (send !== null) {
			// Sent from outside a message, nothing else drops what it kept.
			const { text, files: sending } = boxFiles.reply(
				questions,
				saidOf(),
				written.more,
			);
			void attempt(
				send(approved(text), sending).then(() => {
					kept.write("");
					boxFiles.clear();
					onSent?.();
				}),
				"Not sent",
			);
		}
	};
	const panel = useRef<HTMLDivElement>(null);
	const finishThen = useCardDictationTurn(panel);
	const taking = useBoxTaking();
	// A take under way sends once it is done, from the render that holds its
	// words: the click's own `submit` reads the box from before them.
	const [sendTaken, setSendTaken] = useState(false);
	useEffect(() => {
		if (sendTaken) {
			setSendTaken(false);
			submit();
		}
	});
	const sendNow = () => finishThen(() => setSendTaken(true));
	// Answered, every question shows, as on any other card.
	const paging = paged && live;
	// The screen shown when paging, over a footer pinned to the sheet's foot:
	// a question's index, or `end` for "Anything else", which the last
	// question opens only when asked.
	const [page, setPage] = useState(0);
	const end = questions.length;
	// From the last question, or "Anything else", the footer sends.
	const sending = page >= end - 1;
	// Whether the page turned to takes the focus, and raises the keyboard
	// even on a touch screen, as when Enter turned it from a field; null when
	// the focus stays where it is, as on the button that turned it.
	const landing = useRef<{ typing: boolean } | null>(null);
	const turn = (to: number, land: { typing: boolean } | null = null) => {
		const move = () => {
			landing.current = land;
			setPage(to);
			panel.current?.closest("[data-sheet]")?.scrollTo({ top: 0 });
		};
		finishThen(move);
	};
	// Each question's first stop, then "Anything else": where Enter goes next.
	const stops = () => [
		...(panel.current?.querySelectorAll<HTMLElement>("[data-stop]") ?? []),
	];
	const next = (number: string) => {
		if (paging) {
			const at = questions.findIndex((asked) => asked.number === number);
			if (at + 1 < end) {
				turn(at + 1, { typing: raises(document.activeElement) });
			} else if (document.activeElement instanceof HTMLElement) {
				// The last one goes on to Send: the keyboard drops to show it.
				document.activeElement.blur();
			}
			return;
		}
		const all = stops();
		const following =
			all[all.findIndex((stop) => stop.dataset.stop === number) + 1];
		// The whole question in view, not just its first stop, which the
		// browser would leave at the very foot of the thread.
		focusStop(following, { preventScroll: true });
		following?.closest("li, [data-more]")?.scrollIntoView({ block: "nearest" });
		toEnd(following);
	};
	// A take makes its box inert, which drops the focus to the page, so Enter
	// never reaches the box: catch it there, let the take finish with its words
	// kept, then do what Enter does from that box.
	const enterTaking = () => {
		const owner = panel.current?.querySelector<HTMLElement>(
			"[data-dictation-owner]",
		);
		if (owner === null || owner === undefined) {
			return false;
		}
		const number = owner
			.closest("li")
			?.getAttribute("aria-label")
			?.replace("question ", "");
		const at = questions.findIndex((asked) => asked.number === number);
		if (number === undefined || at === -1 || (paging && at === end - 1)) {
			sendNow();
		} else if (paging) {
			next(number);
		} else {
			finishThen(() => next(number));
		}
		return true;
	};
	useEnterWhileTaking(live, enterTaking);
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
	// Ending an escalation or under a proposal, they are its card: headed as
	// it, what it says first. A proposal the task escalated to wait on is
	// the escalation's card, led by what it proposed, which its title said.
	const reported =
		proposal !== null
			? escalation === null
				? proposal.body
				: [`Proposed ${proposal.subject}`, proposal.body]
						.filter((each) => each !== "")
						.join("\n\n")
			: escalation === null
				? ""
				: reportText(escalation);
	const card = (
		<CardShell
			{...questionHeading(questions.length, escalation, proposal)}
			// Each question marks itself while it has the focus.
			ringed={false}
		>
			<div
				ref={panel}
				// Paging, it fills its sheet, so its footer sits at the foot.
				className={cn(paging && "flex flex-1 flex-col")}
				onKeyDownCapture={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						event.stopPropagation();
						sendNow();
					}
				}}
			>
				{reported !== "" && (!paging || page === 0) && (
					<div className="border-b">
						<CardBody text={reported} lead={escalation?.reason != null} />
					</div>
				)}
				{demo !== null && (!paging || page === 0) && (
					<DemoSection demo={demo} />
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
									files={files?.of(asked.text) ?? null}
									onAnswer={(next) =>
										setAnswer(asked, isEmpty(next) ? null : next)
									}
									onNext={() => next(asked.number)}
								/>
							),
						)}
					</ol>
				)}
				{!paging && (live ? answer === null : more !== "") && (
					// Below the questions, as one more, numbered and asked like them:
					// barred while it has the focus, as each question is.
					<div
						data-more
						className={cn(
							"relative flex gap-3 border-t px-4 py-4",
							live &&
								"transition-colors duration-150 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary before:opacity-0 before:transition-opacity before:duration-150 focus-within:bg-muted/40 focus-within:before:opacity-100",
						)}
					>
						<span
							aria-hidden
							className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[11px] text-muted-foreground tabular-nums"
						>
							{questions.length + 1}
						</span>
						<div className="flex min-w-0 flex-1 flex-col gap-3">
							<p className="font-medium text-sm leading-snug">Anything else?</p>
							{live ? (
								<CardBox
									data-stop="more"
									aria-label="Anything else"
									value={written.more}
									placeholder="Your answer (optional)"
									onValue={(more) => write({ ...written, more })}
									files={files?.of(MORE) ?? null}
									onKeyDown={(event) => {
										// Enter sends, as in the composer; Shift+Enter is a new line.
										if (event.key === "Enter" && !event.shiftKey) {
											event.preventDefault();
											submit();
										}
									}}
									className="min-h-9 pointer-coarse:min-h-11"
								/>
							) : (
								// What else the person said, as it was sent: its box, frozen.
								<fieldset
									aria-label="Anything else"
									className="min-w-0 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm"
								>
									<Markdown
										text={more}
										className="min-w-0 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
									/>
								</fieldset>
							)}
						</div>
					</div>
				)}
				{paging && page === end - 1 && (
					<div className="px-5 pb-5">
						<button
							type="button"
							onClick={() => turn(end)}
							className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-muted px-3 py-2.5 text-left active:bg-muted/70"
						>
							<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background text-primary">
								<MessageSquarePlusIcon className="size-4.5" />
							</span>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="font-medium text-sm">Anything else?</span>
								<span className="truncate text-muted-foreground text-xs">
									{written.more.trim() === ""
										? "Something the questions didn't cover"
										: written.more.trim()}
								</span>
							</span>
							<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
						</button>
					</div>
				)}
				{paging && page === end && (
					<AnythingElsePage
						questions={questions}
						answers={answers}
						more={written.more}
						onMore={(more) => write({ ...written, more })}
						files={files?.of(MORE) ?? null}
						onTurn={turn}
					/>
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
							{!sending ? (
								<Button
									className="h-11 flex-1 text-base"
									onClick={() => turn(page + 1)}
								>
									Next
									<ChevronRightIcon data-icon="inline-end" />
								</Button>
							) : (
								<Button
									variant={approving ? "success" : "default"}
									className="h-11 flex-1 text-base"
									disabled={empty && !taking}
									onClick={sendNow}
								>
									{approving ? (
										<CheckIcon data-icon="inline-start" />
									) : (
										<SendHorizontalIcon data-icon="inline-start" />
									)}
									{approving ? "Approve" : "Send"}
								</Button>
							)}
						</div>
						<Refusal refusal={refusal} className="text-right" />
					</footer>
				) : live ? (
					<footer className="flex flex-col gap-2.5 border-t bg-muted/20 px-4 py-3">
						<div className="flex items-center gap-3">
							<p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
								{!touch && (
									<>
										<span>
											<Kbd>↵</Kbd> next
										</span>
										<span>
											<Kbd>⌘↵</Kbd>{" "}
											{answer !== null
												? "answers"
												: approving
													? "approves"
													: "sends"}
										</span>
									</>
								)}
							</p>
							<Button
								size="sm"
								variant={answer === null && approving ? "success" : "default"}
								disabled={empty && !taking}
								onClick={sendNow}
							>
								{approving ? (
									<CheckIcon data-icon="inline-start" />
								) : (
									<SendHorizontalIcon data-icon="inline-start" />
								)}
								<span aria-live="polite">
									{answer !== null ? "Answer" : approving ? "Approve" : "Send"}
								</span>
							</Button>
						</div>
						<Refusal refusal={refusal} className="text-right" />
					</footer>
				) : null}
			</div>
		</CardShell>
	);
	if (sent === null && !askedAgain) {
		return card;
	}
	return (
		<div className="my-6">
			<SplatesEvent
				event={questionOutcome(
					questions.length,
					proposal,
					sent,
					() => setShown(!shown),
					shown,
				)}
			/>
			{shown && card}
		</div>
	);
}

/** Puts the caret at the end of what `stop` holds, when it is a box. */
function toEnd(stop: HTMLElement | null | undefined): void {
	if (stop?.isContentEditable) {
		caretToEnd(stop);
	}
}

/** What the panel holds before it is sent: answers by question line, and the rest. */
interface Written {
	answers: Record<string, Answer>;
	more: string;
}
