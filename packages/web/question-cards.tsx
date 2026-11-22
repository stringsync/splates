import type { Demo, Question, TaskReport } from "@splates/server/plans";
import {
	type Answer,
	answerIn,
	besides,
	isEmpty,
	replyOf,
	takenOf,
} from "@splates/server/plans/browser";
import { useReactive, useResource } from "core/react";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	SendHorizontalIcon,
} from "lucide-react";
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { focusStop, raises, useTouch } from "#web/hooks/use-touch.ts";
import { cn } from "#web/lib/utils.ts";
import { AnythingElsePage } from "./anything-else-page";
import { usePlanPage } from "./artifact-open";
import { BoxFiles, MORE } from "./box-files";
import { CardBox, useBoxTaking, useCardDictationTurn } from "./card-box";
import { useArrival, useCardReply, useKept } from "./card-reply";
import { CardBody, CardShell, reportText } from "./card-shell";
import { DemoSection } from "./demo-cards";
import { useEnterWhileTaking } from "./enter-while-taking";
import { Markdown } from "./markdown";
import { PlanAnswer } from "./plan-answer";
import { usePlanComments } from "./plan-comments";
import { PlanLightbox, PlanTile, usePlanName } from "./plan-tile";
import { QuestionCard } from "./question-card";
import { toEnd } from "./question-focus";
import { questionHeading } from "./question-heading";
import { questionOutcome, replyText } from "./question-outcome";
import { Refusal, refusalOf } from "./refusal";
import { label } from "./shortcuts";
import { SplatesEvent } from "./splates-event";

/**
 * The panel a thread's questions are answered in, by keyboard alone. Questions
 * with a `(chosen)` choice come answered with it. What is written stays in the
 * panel until it is sent.
 */
export function QuestionCards({
	questions,
	escalation = null,
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
				questions.map((asked) => next.answers[asked.text] ?? null),
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
		sent === null ? writtenFor(asked) : answerIn(sent, asked),
	);
	const more = sent === null ? written.more : besides(sent, questions);
	const taking = useBoxTaking();
	const send = answer !== null ? null : (reply?.send ?? null);
	// What is attached to each box, where the reply can carry files.
	const boxFiles = useResource(() => new BoxFiles(), []);
	const files = send === null ? null : boxFiles;
	const attached = useReactive(boxFiles, (each) => each.any, ["changed"]);
	const said = questions.map((asked) => writtenFor(asked));
	// Comments made on the plan's page, sent after the answers.
	const planComments = usePlanComments();
	const empty =
		replyOf(questions, said, written.more) === "" &&
		!attached &&
		!planComments.any;
	// A failed send says so until the next try, rather than for a moment: the
	// person may have looked away, and the card is back to unanswered.
	const [refusal, setRefusal] = useState<string | null>(null);
	const attempt = (write: Promise<void>, failed: string) => {
		setRefusal(null);
		return write.then(
			() => true,
			(error: unknown) => {
				setRefusal(refusalOf(failed, error));
				return false;
			},
		);
	};
	const submit = () => {
		// The phone's Send is always on, so an empty reply says so.
		if (!live || (empty && !paging)) {
			return;
		}
		if (answer !== null) {
			void attempt(
				answer(said).then(() => {
					kept.write("");
					onSent?.();
				}),
				"Not answered",
			);
		} else if (send !== null) {
			// Sent from outside a message, nothing else drops what it kept.
			const { text, files: sending } = boxFiles.reply(
				questions,
				said,
				written.more,
			);
			void attempt(
				planComments
					.send(send, replyText(planComments.joinedTo(text)), sending)
					.then(() => {
						kept.write("");
						planComments.clear();
						boxFiles.clear();
						onSent?.();
					}),
				"Not sent",
			);
		}
	};
	const panel = useRef<HTMLDivElement>(null);
	const finishThen = useCardDictationTurn(panel);
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
	// From "Anything else", which always comes last, the footer sends.
	const sending = page >= end;
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
			turn(at + 1, { typing: raises(document.activeElement) });
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
		if (number === undefined || at === -1) {
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
	// The plan the approval question asks about, inside it, its page opened in
	// the lightbox with only its question, answered as one with the card.
	const [planQuestion, setPlanQuestion] = useState<string | null>(null);
	const plan = usePlanPage(
		questions.find((asked) => typeof asked.plan === "string")?.plan ?? null,
	);
	const planName = usePlanName();
	const tileOf = (asked: Question) =>
		asked.plan === undefined ? null : (
			<PlanTile
				name={planName}
				page={typeof asked.plan === "string" ? plan : null}
				onOpen={() => setPlanQuestion(asked.number)}
			/>
		);
	const planSheet = (
		<PlanLightbox
			page={plan}
			name={planName}
			open={planQuestion !== null && live}
			onClose={() => setPlanQuestion(null)}
			onReference={(reference) =>
				write({
					...written,
					more:
						written.more === "" ? reference : `${written.more}\n${reference}`,
				})
			}
			markups={planComments.markups}
			comments={planComments.comments}
			onComments={planComments.set}
			questions={
				<PlanAnswer
					key={planQuestion}
					question={
						questions.find((asked) => asked.number === planQuestion)?.text ?? ""
					}
					onBack={() => setPlanQuestion(null)}
				>
					<ol aria-label="questions" className="divide-y">
						{questions
							.filter((asked) => asked.number === planQuestion)
							.map((asked) => (
								<QuestionCard
									key={asked.number}
									asked={asked}
									headed={false}
									answer={answers[questions.indexOf(asked)] ?? null}
									live={live}
									files={files?.of(asked.text) ?? null}
									onAnswer={(next) =>
										setAnswer(asked, isEmpty(next) ? null : next)
									}
									onNext={() => {}}
								/>
							))}
					</ol>
				</PlanAnswer>
			}
		/>
	);
	// Ending an escalation, they are its card: headed as it, what it says first.
	const reported = escalation === null ? "" : reportText(escalation);
	const card = (
		<CardShell
			{...questionHeading(questions.length, escalation)}
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
									plan={tileOf(asked)}
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
									<Markdown text={more} className="min-w-0" />
								</fieldset>
							)}
						</div>
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
									variant="outline"
									className="h-11 flex-1 border-border bg-white text-base text-black hover:bg-white/90 hover:text-black active:bg-white/80 active:text-black dark:border-border dark:bg-white dark:hover:bg-white/90 dark:active:bg-white/80"
									onClick={() => turn(page + 1)}
								>
									Next
									<ChevronRightIcon data-icon="inline-end" />
								</Button>
							) : (
								<Button
									variant="default"
									className="h-11 flex-1 bg-black text-base text-white hover:bg-black/90 active:bg-black/80"
									onClick={sendNow}
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
						<div className="flex items-center gap-3">
							<p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
								{!touch && (
									<>
										<span>
											<Kbd>↵</Kbd> next
										</span>
										<span>
											<Kbd>{label("Mod+Enter")}</Kbd>{" "}
											{answer !== null ? "answers" : "sends"}
										</span>
									</>
								)}
							</p>
							<Button
								size="sm"
								variant="default"
								disabled={empty && !taking}
								onClick={sendNow}
							>
								<SendHorizontalIcon data-icon="inline-start" />
								<span aria-live="polite">
									{answer !== null ? "Answer" : "Send"}
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
		return (
			<>
				{card}
				{planSheet}
			</>
		);
	}
	return (
		<div className="my-6">
			<SplatesEvent
				event={{
					mark: null,
					words: questionOutcome(questions.length, escalation),
					act: { label: shown ? "Hide" : "Show", run: () => setShown(!shown) },
				}}
			/>
			{shown && card}
		</div>
	);
}

/** What the panel holds before it is sent: answers by question line, and the rest. */
interface Written {
	answers: Record<string, Answer>;
	more: string;
}
