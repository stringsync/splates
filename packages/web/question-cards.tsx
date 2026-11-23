import type {
	Demo,
	PlanCard,
	Question,
	TaskReport,
} from "@splates/server/plans";
import { type Answer, isEmpty, replyOf } from "@splates/server/plans/browser";
import { useReactive, useResource } from "core/react";
import {
	type JSX,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { focusStop, raises, useTouch } from "#web/hooks/use-touch.ts";
import { cn } from "#web/lib/utils.ts";
import { AnythingElsePage } from "./anything-else-page";
import { AnythingElseSection } from "./anything-else-section";
import { BoxFiles, MORE } from "./box-files";
import { useBoxTaking, useCardDictationTurn } from "./card-box";
import { useArrival, useCardReply } from "./card-reply";
import { CardBody, CardShell, reportText } from "./card-shell";
import { DemoSection } from "./demo-cards";
import { useEnterWhileTaking } from "./enter-while-taking";
import { outsideCode } from "./markdown";
import { usePlanComments } from "./plan-comments";
import { QuestionCard } from "./question-card";
import { decisionOf, QuestionCardsFooter } from "./question-cards-footer";
import { useQuestionDrafts } from "./question-drafts";
import { toEnd } from "./question-focus";
import { questionHeading } from "./question-heading";
import { questionOutcome, replyText } from "./question-outcome";
import { useQuestionPlan } from "./question-plan-lightbox";
import { refusalOf } from "./refusal";
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
	plan: planned = null,
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
	/** The plan they decide, which heads them, its body above them. */
	plan?: PlanCard | null;
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
	const touch = useTouch();
	const { kept, written, write, writtenFor, setAnswer, answers, more } =
		useQuestionDrafts({ questions, draft, sent, earlier });
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
	// The plan's approval, decided from the footer rather than by its choices.
	const decision = decisionOf(questions);
	const feedbackOwner = useId();
	const feedbackTaking = useBoxTaking(feedbackOwner);
	const feedback =
		decision === null ? "" : (writtenFor(decision.asked)?.words ?? "");
	const feedbackAttached = useReactive(
		boxFiles,
		(each) =>
			decision !== null && each.of(decision.asked.text).files.length > 0,
		["changed"],
	);
	const sendingFeedback =
		feedback.trim() !== "" || feedbackAttached || feedbackTaking;
	// Approves, rejects, requests a full plan, sends a note without approving,
	// or (on Enter) approves when empty and sends words with no choice otherwise.
	// Waits for any dictation take to finish first so its words are included.
	const [pendingDecision, setPendingDecision] = useState<
		"approve" | "reject" | "full" | "send" | "submit" | null
	>(null);
	useEffect(() => {
		if (pendingDecision === null || decision === null) {
			return;
		}
		setPendingDecision(null);
		if (pendingDecision === "send") {
			setAnswer(
				decision.asked,
				feedback === "" ? null : { picks: [], words: feedback },
			);
			if (feedback.trim() !== "" || feedbackAttached || !empty) {
				setSendTaken(true);
			}
			return;
		}
		const key =
			pendingDecision === "full"
				? decision.full
				: pendingDecision === "reject"
					? decision.reject
					: pendingDecision === "approve"
						? decision.approve
						: feedback.trim() === ""
							? decision.approve
							: null;
		setAnswer(decision.asked, {
			picks: key === null ? [] : [key],
			words: feedback,
		});
		setSendTaken(true);
	});
	const decide = (pick: "approve" | "reject" | "full" | "send" | "submit") => {
		if (decision === null) {
			return;
		}
		finishThen(() => setPendingDecision(pick));
	};
	// Answered, every question shows, as on any other card.
	const paging = paged && live;
	// The screen shown when paging, over a footer pinned to the sheet's foot:
	// a question's index, or `end` for "Anything else", which the last
	// question opens only when asked.
	const [page, setPage] = useState(0);
	// With a decision the last question's page sends; there is no "Anything else".
	const end = decision === null ? questions.length : questions.length - 1;
	// From "Anything else", which always comes last, the footer sends.
	const sending = page >= end;
	const decidingHere = decision !== null && paging && page === end;
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
			if (decision !== null) {
				decide("submit");
			} else {
				sendNow();
			}
		} else if (questions[at] === decision?.asked) {
			decide("submit");
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
	const { tileOf, lightbox: planSheet } = useQuestionPlan({
		questions,
		planned,
		answers,
		live,
		decisionAsked: decision?.asked,
		files,
		markups: planComments.markups,
		comments: planComments.comments,
		onReference: (reference) =>
			write({
				...written,
				more: written.more === "" ? reference : `${written.more}\n${reference}`,
			}),
		onComments: planComments.set,
		onAnswer: setAnswer,
	});
	// Ending an escalation, they are its card: headed as it, what it says first.
	const reported = escalation === null ? "" : reportText(escalation);
	// A markdown plan card renders its final approval prompt as an "Anything
	// else?" note section instead of repeating "Do you approve ...?".
	const inlineDecision = planned !== null && decision !== null && live;
	const listedQuestions = inlineDecision ? questions.slice(0, -1) : questions;
	const hasReported = reported !== "" && (!paging || page === 0);
	const hasPlanned =
		planned !== null && planned.body !== "" && (!paging || page === 0);
	const hasDemo = demo !== null && (!paging || page === 0);
	const hasBody = hasReported || hasPlanned;
	const hasIntro = hasBody || hasDemo;
	const showCounter =
		paging &&
		(page < end || (decidingHere && !inlineDecision)) &&
		(inlineDecision ? listedQuestions.length > 0 : questions.length > 1);
	const card = (
		<CardShell
			{...questionHeading(questions.length, escalation, undefined, planned)}
			aside={
				planned !== null && live ? (
					<span className="text-muted-foreground text-xs">
						Awaiting approval
					</span>
				) : undefined
			}
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
						if (decision !== null) {
							decide("submit");
						} else {
							sendNow();
						}
					}
				}}
			>
				{hasReported && (
					<CardBody text={reported} lead={escalation?.reason != null} />
				)}
				{hasPlanned && (
					<div className={hasReported ? "rule-t" : undefined}>
						<CardBody text={planBody(planned.body)} />
					</div>
				)}
				{hasDemo && <DemoSection demo={demo} ruled={hasBody} />}
				{showCounter && (
					<p
						className={cn(
							"px-5 pt-5 font-medium text-muted-foreground text-sm tabular-nums",
							hasIntro && "rule-t [--rule-inset:1.25rem]",
						)}
					>
						Question {page + 1} of{" "}
						{inlineDecision ? listedQuestions.length : questions.length}
					</p>
				)}
				{(!paging || page < end || (decidingHere && !inlineDecision)) &&
					listedQuestions.length > 0 && (
						<ol
							aria-label="questions"
							className={cn("rule-y", hasIntro && !showCounter && "rule-t")}
						>
							{listedQuestions.map((asked, at) =>
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
										onNext={() =>
											asked === decision?.asked
												? decide("submit")
												: next(asked.number)
										}
										plan={tileOf(asked)}
										decided={asked === decision?.asked}
										dictationOwner={
											asked === decision?.asked ? feedbackOwner : undefined
										}
									/>
								),
							)}
						</ol>
					)}
				{inlineDecision && (!paging || page === end) && (
					<AnythingElseSection
						number={listedQuestions.length > 0 ? questions.length : undefined}
						value={feedback}
						placeholder="Request changes, or leave a note…"
						stop={decision.asked.number}
						live
						roomy={paging}
						ruled={hasIntro || listedQuestions.length > 0}
						files={files?.of(decision.asked.text) ?? null}
						dictationOwner={feedbackOwner}
						onValue={(words) => {
							const prior = writtenFor(decision.asked) ?? {
								picks: [],
								words: "",
							};
							const nextAnswer = { ...prior, words };
							setAnswer(
								decision.asked,
								isEmpty(nextAnswer) ? null : nextAnswer,
							);
						}}
						onSubmit={() => decide("submit")}
					/>
				)}
				{!paging &&
					(live ? answer === null && decision === null : more !== "") && (
						<AnythingElseSection
							number={questions.length + 1}
							value={written.more}
							frozen={more}
							placeholder="Your answer (optional)"
							stop="more"
							live={live}
							ruled={hasIntro || listedQuestions.length > 0}
							files={files?.of(MORE) ?? null}
							onValue={(more) => write({ ...written, more })}
							onSubmit={submit}
						/>
					)}
				{paging && page === end && decision === null && (
					<AnythingElsePage
						questions={questions}
						answers={answers}
						more={written.more}
						onMore={(more) => write({ ...written, more })}
						files={files?.of(MORE) ?? null}
						onTurn={turn}
					/>
				)}
				<QuestionCardsFooter
					paging={paging}
					live={live}
					page={page}
					sending={sending}
					decidingHere={decidingHere}
					decision={decision}
					sendingFeedback={sendingFeedback}
					planned={planned !== null}
					touch={touch}
					answering={answer !== null}
					empty={empty}
					taking={taking}
					refusal={refusal}
					onTurn={turn}
					onSend={sendNow}
					onDecide={decide}
				/>
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

/** The plan format puts each field on a new line. Markdown needs a blank line between paragraphs. */
function planBody(text: string): string {
	return outsideCode(text, (prose) =>
		prose.replace(
			/(?<!\n)\n(?=\*\*(?:Goal|After|Approach|Hard to undo):\*\*)/g,
			"\n\n",
		),
	);
}
