import type { PlanTrusted } from "@splates/server/conversations";
import type { PlanCard, Question, TaskReport } from "@splates/server/plans";
import {
	type Answer,
	approvalOf,
	isEmpty,
	replyOf,
} from "@splates/server/plans/browser";
import { useReactive, useResource } from "core/react";
import {
	type JSX,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
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
import { cardSendPolicy } from "./card-send-policy";
import { CardBody, CardShell, reportText } from "./card-shell";
import { useEnterWhileTaking } from "./enter-while-taking";
import { EvalProposalCard } from "./eval-proposal-card";
import { evalQuestionOf } from "./eval-question";
import { MergeCardContext } from "./merge-card";
import { PlanBody } from "./plan-body";
import {
	type PlanChoice,
	PlanDecision,
	planApprovalDefaults,
} from "./plan-decision";
import { QuestionCard } from "./question-card";
import { QuestionCardsFooter } from "./question-cards-footer";
import { useQuestionDrafts } from "./question-drafts";
import { toEnd } from "./question-focus";
import { questionHeading } from "./question-heading";
import { questionOutcome, replyText } from "./question-outcome";
import { QuestionSteps, type StepState } from "./question-steps";
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
	plan: planned = null,
	planAt = null,
	draft = null,
	earlier = [],
	paged = false,
	stepped = false,
	answer = null,
	onSent,
	wentAhead = null,
}: {
	questions: Question[];
	/** The escalation they end, which heads them in its place. */
	escalation?: TaskReport | null;
	/** The plan they decide, which heads them, its body above them. */
	plan?: PlanCard | null;
	planAt?: string | null;
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
	 * Whether, off a phone's sheet, it shows one question at a time in place
	 * when it asks two or more, with a row of steps over them, Send on the
	 * last, and "Show all" for every question down the card. Only while it
	 * can be answered.
	 */
	stepped?: boolean;
	/**
	 * Answers in place of a reply, as for a form its agent asks through ACP:
	 * each question's answer, in order. Nothing else is asked for beside them.
	 */
	answer?: ((answers: (Answer | null)[]) => Promise<void>) | null;
	/** Once the reply is sent from it. */
	onSent?: () => void;
	/**
	 * The trust the agent went ahead on the plan with before the person
	 * answered it: drawn as a line of splates's saying so, the card opening
	 * from it for changes. Null while the plan waits, or has none.
	 */
	wentAhead?: PlanTrusted | null;
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
	// A plan that asks its own approval question has it answered with the
	// others; one without gets its own decision question above Send.
	const asksApproval = planned !== null && approvalOf(questions) !== null;
	const listed = questions;
	const listedAnswers = questions.map((_, at) => answers[at] ?? null);
	const taking = useBoxTaking();
	const send = answer !== null ? null : (reply?.send ?? null);
	// What is attached to each box, where the reply can carry files.
	const boxFiles = useResource(() => new BoxFiles(), []);
	const files = send === null ? null : boxFiles;
	const attached = useReactive(boxFiles, (each) => each.any, ["changed"]);
	const said = questions.map((asked) => writtenFor(asked));
	const empty = replyOf(questions, said, written.more) === "" && !attached;
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
	const decidePlan = planned !== null && !asksApproval && send !== null;
	// The plan's decision and post-approval options, seeded from plan tags.
	const [decision, setDecision] = useState<PlanChoice | null>(null);
	const approvalDefaults = useMemo(
		() => (planned === null ? null : planApprovalDefaults(planned.body)),
		[planned],
	);
	const [reviewOverride, setReviewOverride] = useState<boolean | null>(null);
	const [archiveOverride, setArchiveOverride] = useState<boolean | null>(null);
	const reviewRequired = approvalDefaults?.reviewRequired ?? null;
	const reviewBeforeMerge =
		reviewRequired !== null
			? true
			: (reviewOverride ?? approvalDefaults?.review ?? false);
	const archiveAfterMergeChoice = reviewBeforeMerge
		? false
		: (archiveOverride ?? approvalDefaults?.archive ?? false);
	const archiveAfterMergeArmed =
		useContext(MergeCardContext)?.archiveAfterMerge === true;
	const unansweredPlan = said.some((answer) => answer === null);
	const [pending, setPending] = useState(false);
	const sendPolicy = cardSendPolicy({
		live,
		pending,
		decidePlan,
		decision,
		unansweredPlan,
		empty,
		taking,
		answering: answer !== null,
	});
	const submit = () => {
		if (!sendPolicy.canSubmit) {
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
			const action =
				decision === "revise"
					? "Request changes"
					: reviewBeforeMerge || decision === "review"
						? "Approve & review"
						: "Approve";
			const message = decidePlan
				? [
						`${action}: ${planned.title}`.trimEnd() +
							(planAt ? `\nPlan from ${planAt}` : ""),
						text,
					]
						.filter(Boolean)
						.join("\n\n")
				: replyText(text);
			const sendOptions =
				decidePlan && decision !== "revise" && archiveAfterMergeChoice
					? { archiveAfterMerge: true }
					: undefined;
			setPending(true);
			void attempt(
				send(message, sending, sendOptions).then(() => {
					kept.write("");
					boxFiles.clear();
					onSent?.();
				}),
				"Not sent",
			).finally(() => setPending(false));
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
	const sendNow = () => {
		if (sendPolicy.disabled) {
			return;
		}
		finishThen(() => setSendTaken(true));
	};
	// A lone question asking about an eval is the eval's own card, asked
	// under its checks.
	const lone =
		listed.length === 1 && planned === null && escalation === null
			? evalQuestionOf(listed[0]?.body ?? "")
			: null;
	const hasReview = answer === null && lone === null;
	// Answered, every question shows, as on any other card.
	const sheet = paged && live && (listed.length > 0 || decidePlan);
	// Every question down the card, as asked for from the steps.
	const [whole, setWhole] = useState(false);
	// A plan's decision and review each get a step of their own; ordinary cards
	// step when there are two or more questions.
	const steppable =
		!paged && stepped && live && (listed.length > 1 || decidePlan);
	// One step at a time in place, as on a desktop.
	const stepping = steppable && !whole;
	const paging = sheet || stepping;
	// Step layout shared by mobile sheets and desktop stepped cards:
	//   0..N-1: each question
	//   decisionPage (when decidePlan): dedicated Decide step
	//   reviewPage (when hasReview): shared Review & send step
	const [page, setPage] = useState(0);
	const decisionPage = decidePlan ? listed.length : null;
	const reviewPage = hasReview
		? decidePlan
			? listed.length + 1
			: listed.length
		: Math.max(0, listed.length - 1);
	const sending = page >= reviewPage;
	// The questions turned to, whose answers have been seen.
	const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set([0]));
	// Whether the page turned to takes the focus, and raises the keyboard
	// even on a touch screen, as when Enter turned it from a field; null when
	// the focus stays where it is, as on the button that turned it.
	const landing = useRef<{ typing: boolean } | null>(null);
	const turn = (to: number, land: { typing: boolean } | null = null) => {
		const move = () => {
			landing.current = land;
			setPage(to);
			setSeen((before) => new Set(before).add(to));
			panel.current?.closest("[data-sheet]")?.scrollTo({ top: 0 });
			if (stepping) {
				panel.current
					?.closest("[data-card]")
					?.scrollIntoView({ block: "nearest" });
			}
		};
		finishThen(move);
	};
	// Each question's first stop, then "Anything else": where Enter goes next.
	const stops = () => [
		...(panel.current?.querySelectorAll<HTMLElement>("[data-stop]") ?? []),
	];
	const next = (number: string) => {
		const at = listed.findIndex((asked) => asked.number === number);
		if (paging) {
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
		const at = listed.findIndex((asked) => asked.number === number);
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
	// Ending an escalation, they are its card: headed as it, what it says first.
	const reported = escalation === null ? "" : reportText(escalation);
	const hasReported = reported !== "" && (!paging || page === 0);
	const hasPlanned =
		planned !== null && planned.body !== "" && (!paging || page === 0);
	const hasIntro = hasReported || hasPlanned;
	const states = listed.map(
		(_, at): StepState =>
			listedAnswers[at] == null
				? "unanswered"
				: seen.has(at)
					? "seen"
					: "picked",
	);
	// The first question after this one with no answer, coming round to the
	// start; null when every other one is answered.
	const unanswered =
		[...listed.keys()]
			.map((offset) => (page + 1 + offset) % listed.length)
			.find((at) => at !== page && listedAnswers[at] == null) ?? null;
	// Paging, the decision sits flat on its own dedicated Decide step; in Show
	// all mode down the card, it sits framed at the bottom above Send.
	const decisionPanel = decidePlan &&
		live &&
		(!paging || page === decisionPage) && (
			<PlanDecision
				choice={decision}
				onChoice={setDecision}
				review={reviewBeforeMerge}
				onReview={setReviewOverride}
				archive={archiveAfterMergeChoice}
				onArchive={setArchiveOverride}
				reviewRequired={reviewRequired}
				unanswered={!sendPolicy.canApprove}
				roomy={sheet}
				leading={paging && listed.length > 0}
				flat={paging}
				stop={paging ? "decision" : undefined}
				onNext={paging ? () => turn(reviewPage) : undefined}
			/>
		);
	// Otherwise the evals its questions ask about, each its own card above
	// it: paging, only the one on the page.
	const evals = listed.flatMap((asked, at) => {
		if (lone !== null) {
			return [];
		}
		const evaled = paging && at !== page ? null : evalQuestionOf(asked.body);
		return evaled === null ? [] : [{ number: asked.number, ...evaled }];
	});
	const showSteps =
		paging && (listed.length > 1 || decidePlan || (sheet && hasReview));
	const inside = (
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
			{hasReported && (
				<CardBody text={reported} lead={escalation?.reason != null} />
			)}
			{hasPlanned && (
				<div className={hasReported ? "rule-t" : undefined}>
					<PlanBody text={planned.body} />
				</div>
			)}
			{showSteps && (
				<QuestionSteps
					states={states}
					page={page}
					ruled={hasIntro}
					deciding={decidePlan}
					reviewing={hasReview}
					roomy={sheet}
					onTurn={(to) => turn(to)}
					onWhole={stepping ? () => setWhole(true) : undefined}
				/>
			)}
			{(!paging || page < listed.length) && listed.length > 0 && (
				<ol
					aria-label="questions"
					className={cn(
						!paging && "rule-y",
						hasIntro && !showSteps && "rule-t",
					)}
				>
					{listed.map((asked, at) =>
						paging && at !== page ? null : (
							<QuestionCard
								key={asked.number}
								asked={asked}
								answer={listedAnswers[at] ?? null}
								live={live}
								roomy={sheet}
								files={files?.of(asked.text) ?? null}
								// The eval card it sits in says what it is.
								headed={lone === null}
								onAnswer={(next) =>
									setAnswer(asked, isEmpty(next) ? null : next)
								}
								onNext={() => next(asked.number)}
							/>
						),
					)}
				</ol>
			)}
			{paging && decisionPanel}
			{/* A lone eval's approval takes its note in the decision's own box. */}
			{lone === null && !paging && (live ? answer === null : more !== "") && (
				<AnythingElseSection
					number={listed.length + 1}
					value={written.more}
					frozen={more}
					placeholder="Your answer (optional)"
					stop="more"
					live={live}
					ruled={hasIntro || listed.length > 0}
					files={files?.of(MORE) ?? null}
					onValue={(more) => write({ ...written, more })}
					onSubmit={submit}
				/>
			)}
			{paging && hasReview && page === reviewPage && (
				<AnythingElsePage
					questions={listed}
					answers={listedAnswers}
					decision={
						decisionPage === null
							? null
							: {
									choice: decision,
									review: reviewBeforeMerge,
									archive: archiveAfterMergeChoice,
									unanswered: !sendPolicy.canApprove,
									onChange: () => turn(decisionPage),
								}
					}
					more={written.more}
					onMore={(more) => write({ ...written, more })}
					onSubmit={sheet ? undefined : submit}
					files={files?.of(MORE) ?? null}
					roomy={sheet}
					onTurn={turn}
				/>
			)}
			{!paging && decisionPanel}
			<QuestionCardsFooter
				paging={sheet}
				stepping={stepping}
				steppable={steppable}
				unanswered={unanswered}
				onWhole={setWhole}
				live={live}
				page={page}
				sending={sending}
				planned={planned !== null}
				touch={touch}
				send={sendPolicy}
				refusal={refusal}
				onTurn={turn}
				onSend={sendNow}
			/>
		</div>
	);
	const shell =
		lone !== null ? (
			<EvalProposalCard
				proposal={lone.proposal}
				label={questionHeading(1, null).label}
			>
				{inside}
			</EvalProposalCard>
		) : (
			<CardShell
				{...questionHeading(questions.length, escalation, undefined, planned)}
				aside={
					planned !== null && live && wentAhead === null ? (
						<span className="text-muted-foreground text-xs">
							Awaiting approval
						</span>
					) : undefined
				}
				// Each question marks itself while it has the focus.
				ringed={false}
			>
				{inside}
			</CardShell>
		);
	const card =
		evals.length === 0 ? (
			shell
		) : (
			// Down a thread, a block, so the cards' own margins collapse to the
			// usual space between cards; on a sheet, which drops them, a gap.
			<div className={cn(sheet && "flex flex-col gap-3")}>
				{evals.map(({ number, proposal }) => (
					<EvalProposalCard key={number} proposal={proposal} />
				))}
				{shell}
			</div>
		);
	if (sent === null && !askedAgain && planned !== null && wentAhead !== null) {
		// Gone ahead on trust: a line of splates's says the person did not
		// approve it, its card opening below for changes.
		return (
			<div className="my-6">
				<SplatesEvent
					event={{
						mark: "trusted",
						// One string, so it wraps on a phone rather than overflowing.
						words: ["Plan approved on trust, not by you"],
						act: {
							label: shown ? "Hide" : "Show",
							run: () => {
								if (!shown) {
									setDecision("revise");
								}
								setShown(!shown);
							},
						},
					}}
				/>
				{shown && card}
			</div>
		);
	}
	if (sent === null && !askedAgain) {
		return card;
	}
	return (
		<div className="my-6">
			<SplatesEvent
				event={{
					// The plan decision's own icon from the card's panel: green
					// checks for an approval, a muted pencil for changes.
					mark:
						planned === null
							? null
							: sent?.startsWith("Approve & review")
								? "approved"
								: sent?.startsWith("Approve")
									? "plan-approved"
									: sent?.startsWith("Request changes:")
										? "changes-requested"
										: null,
					words:
						planned !== null && sent?.startsWith("Approve & review")
							? ["Plan approved, review before merge"]
							: planned !== null && sent?.startsWith("Approve")
								? [
										archiveAfterMergeArmed
											? "Plan approved, archiving after merge"
											: "Plan approved",
									]
								: planned !== null && sent?.startsWith("Request changes:")
									? ["Changes requested"]
									: questionOutcome(questions.length, escalation),
					act: { label: shown ? "Hide" : "Show", run: () => setShown(!shown) },
				}}
			/>
			{shown && card}
		</div>
	);
}
