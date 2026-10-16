import { useReactive, useResource } from "@webappwiz/react";
import {
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	ListChecksIcon,
	MessageCircleQuestionIcon,
	SendHorizontalIcon,
} from "lucide-react";
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { focusStop, raises, useTouch } from "#dev/hooks/use-touch.ts";
import { cn } from "#dev/lib/utils.ts";
import type { Proposal, TaskReport } from "../asked";
import type { Demo } from "../demo";
import type { Question } from "../plan";
import { APPROVE } from "../prompts";
import {
	type Answer,
	answerIn,
	besides,
	challenges,
	isEmpty,
	replyOf,
	takenOf,
} from "../reply";
import { AnythingElsePage } from "./anything-else-page";
import { AssumptionList } from "./assumption-list";
import { caretToEnd } from "./box-editor";
import { BoxFiles, MORE } from "./box-files";
import { copiedLabel, useCopy } from "./card";
import { CardBox } from "./card-box";
import { useArrival, useCardReply, useKept } from "./card-reply";
import { CardBody, CardShell, ENDINGS, reportText } from "./card-shell";
import { DemoSection } from "./demo-cards";
import { Markdown } from "./markdown";
import { QuestionCard } from "./question-card";
import { Refusal, useRefusal } from "./refusal";

/**
 * The questions as a panel answered by keyboard alone: a letter picks a
 * choice, the arrows move between them, Enter goes on to the next question
 * and from "Anything else" sends, as ⌘Enter does from anywhere in it. What is
 * written stays in the panel, never the composer, until it is sent, or for
 * an agent outside the page, copied to paste into its session. Under a
 * proposal, each question with a `(chosen)` choice comes answered with it,
 * and once every one is answered, Approve approves the proposal, saying
 * any answer to a call the agent chose nothing for. Picking another choice,
 * challenging a call, or writing anything else makes it a reply instead,
 * saying only what differs, for the agent to propose again. The calls the
 * agent assumed list under them, each challenged as on the review card, a
 * challenge going out with the answers; with no questions, it offers to
 * send only once one is challenged.
 */
export function QuestionCards({
	questions,
	escalation = null,
	proposal = null,
	demo = null,
	assumed = [],
	draft = null,
	earlier = [],
	copy = false,
	paged = false,
	onSent,
}: {
	questions: Question[];
	/** The escalation they end, which heads them in its place. */
	escalation?: TaskReport | null;
	/** The proposal they rest under, which heads them in its place. */
	proposal?: Proposal | null;
	/** The demo they ask about, shown above them. */
	demo?: Demo | null;
	/** The calls the agent says it made without asking, each with what it chose. */
	assumed?: Question[];
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
	// What a proposal's agent chose for `asked`, which it comes answered with.
	const chosen = (asked: Question): Answer | null =>
		proposal !== null && asked.choices.some((choice) => choice.chosen)
			? takenOf(asked)
			: null;
	// What a reply says of `answer`: under a proposal, nothing of one that
	// leaves what the agent chose.
	const said = (asked: Question, answer: Answer | null): Answer | null =>
		proposal === null || answer === null || challenges(asked, answer)
			? answer
			: null;
	// Everything a reply can answer: the questions, then each call assumed,
	// which only a challenge answers.
	const all = [...questions, ...assumed];
	const [written, setWritten] = useState((): Written => {
		const before = kept.read();
		return {
			answers: Object.fromEntries([
				...questions.flatMap((asked) => {
					const answer = answerIn(before, asked) ?? chosen(asked);
					return answer === null ? [] : [[asked.text, answer]];
				}),
				...assumed.flatMap((call) => {
					const answer = answerIn(before, call);
					return answer === null || !challenges(call, answer)
						? []
						: [[call.text, answer]];
				}),
			]),
			more: besides(before, all),
		};
	});
	// By each question's line, which stays put as others come and go.
	const writtenFor = (asked: Question) => written.answers[asked.text] ?? null;
	const write = (next: Written) => {
		setWritten(next);
		kept.write(
			replyOf(
				all,
				all.map((asked) => said(asked, next.answers[asked.text] ?? null)),
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
			: (answerIn(sent, asked) ?? chosen(asked)),
	);
	// The challenge to each call assumed, written or sent; null for none.
	const challenged = assumed.map((call) =>
		sent === null ? writtenFor(call) : answerIn(sent, call),
	);
	const more = sent === null ? written.more : besides(sent, all);
	const answered = answers.filter((answer) => answer !== null).length;
	const send = copy ? null : (reply?.send ?? null);
	// What is attached to each box, where the reply can carry files.
	const boxFiles = useResource(() => new BoxFiles(), []);
	const files = send === null ? null : boxFiles;
	const attached = useReactive(boxFiles, (each) => each.any, ["changed"]);
	const saidOf = () => all.map((asked) => said(asked, writtenFor(asked)));
	// Every one answered, and nothing the agent chose or assumed changed,
	// sending approves the proposal; anything changed is a reply to it.
	const approving =
		proposal !== null &&
		answered === questions.length &&
		!questions.some(
			(asked) =>
				chosen(asked) !== null && said(asked, writtenFor(asked)) !== null,
		) &&
		assumed.every((call) => writtenFor(call) === null) &&
		written.more.trim() === "" &&
		!attached;
	const out = replyOf(all, saidOf(), written.more);
	const empty = !approving && out === "" && !attached;
	// With nothing asked, only a challenge calls for a way to send it.
	const quiet = questions.length === 0 && proposal === null && empty;
	const { copied, copy: copyOut } = useCopy();
	const { refusal, attempt } = useRefusal();
	const submit = () => {
		if (!live || empty) {
			return;
		}
		const approved = (text: string) =>
			!approving ? text : text === "" ? APPROVE : `${APPROVE}\n\n${text}`;
		if (send === null) {
			// Kept, to copy again until its agent records it.
			copyOut(approved(out), onSent);
		} else {
			// Sent from outside a message, nothing else drops what it kept.
			const { text, files: sending } = boxFiles.reply(
				all,
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
	// Ending an escalation or under a proposal, they are its card: headed as
	// it, what it says first.
	const reported =
		proposal !== null
			? proposal.body
			: escalation === null
				? ""
				: reportText(escalation);
	return (
		<CardShell
			{...(proposal !== null
				? {
						label: `proposal ${proposal.subject}`,
						Icon: MessageCircleQuestionIcon,
						title: `Questions: ${proposal.subject}`,
						tone: "info" as const,
					}
				: escalation === null && questions.length === 0
					? {
							label: "assumed",
							Icon: ListChecksIcon,
							title: "Assumed",
							tone: "neutral" as const,
						}
					: escalation === null
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
				paging || questions.length === 0 ? undefined : (
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
									files={files?.of(asked.text) ?? null}
									onAnswer={(next) => {
										const picked = next.picks.some(
											(key) =>
												!(writtenFor(asked)?.picks.includes(key) ?? false),
										);
										if (paging && asked.pick === "one" && picked) {
											goOn(at);
										}
										setAnswer(asked, isEmpty(next) ? null : next);
									}}
									onNext={() => next(asked.number)}
								/>
							),
						)}
					</ol>
				)}
				{assumed.length > 0 && (!paging || page === 0) && (
					<div className="border-t first:border-t-0">
						<AssumptionList
							assumptions={assumed}
							answers={challenged}
							live={live}
							unfolded={questions.length === 0}
							// Alone in the Assumed card, whose title already says them.
							bare={
								proposal === null &&
								escalation === null &&
								questions.length === 0
							}
							onAnswer={(call, next) =>
								setAnswer(call, challenges(call, next) ? next : null)
							}
							onNext={() =>
								focusStop(
									panel.current?.querySelector<HTMLElement>(
										'[data-stop="more"]',
									),
								)
							}
						/>
					</div>
				)}
				{paging && page === end && !quiet && (
					<AnythingElsePage
						questions={questions}
						answers={answers}
						more={written.more}
						onMore={(more) => write({ ...written, more })}
						files={files?.of(MORE) ?? null}
						onTurn={turn}
					/>
				)}
				{quiet ? null : paging ? (
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
									disabled={empty}
									onClick={submit}
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
						<CardBox
							data-stop="more"
							aria-label="Anything else"
							value={written.more}
							placeholder="Anything else?"
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
						<div className="flex items-center gap-3">
							<p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
								{!touch && (
									<>
										<span>
											<Kbd>↵</Kbd> next
										</span>
										<span>
											<Kbd>⌘↵</Kbd>{" "}
											{send === null
												? "copies"
												: approving
													? "approves"
													: "sends"}
										</span>
									</>
								)}
							</p>
							<Button
								size="sm"
								disabled={empty}
								title={copied.state === "failed" ? copied.error : undefined}
								onClick={submit}
								className="pointer-coarse:h-10 pointer-coarse:px-3"
							>
								{send !== null ? (
									approving ? (
										<CheckIcon data-icon="inline-start" />
									) : (
										<SendHorizontalIcon data-icon="inline-start" />
									)
								) : copied.state === "copied" ? (
									<CheckIcon data-icon="inline-start" />
								) : (
									<CopyIcon data-icon="inline-start" />
								)}
								<span aria-live="polite">
									{send === null
										? copiedLabel(copied, "Copy reply")
										: approving
											? "Approve"
											: "Send"}
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

/** Puts the caret at the end of what `stop` holds, when it is a box. */
function toEnd(stop: HTMLElement | null | undefined): void {
	if (stop?.isContentEditable) {
		caretToEnd(stop);
	}
}

/** How long a pick shows before a paging panel goes on from it. */
const GO_ON_MS = 300;

/** What the panel holds before it is sent: answers by question line, and the rest. */
interface Written {
	answers: Record<string, Answer>;
	more: string;
}
