import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import {
	CheckIcon,
	ChevronRightIcon,
	GitMergeIcon,
	SendHorizontalIcon,
} from "lucide-react";
import { type JSX, useContext, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#dev/components/ui/collapsible.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import type { Review } from "../asked";
import { assumptions, type Question } from "../plan";
import { MERGE } from "../prompts";
import { type Answer, answerIn, besides, isEmpty, replyOf } from "../reply";
import { AssumptionList, challengeOf } from "./assumption-list";
import { Board } from "./board";
import { InMessage, useArrival, useCardReply, useKept } from "./card-reply";
import { CardBody, CardShell } from "./card-shell";
import { DemoSection } from "./demo-cards";
import { Markdown } from "./markdown";
import { Refusal, useRefusal } from "./refusal";

/** What a reply typed by hand says to merge, as the review's last line asks. */
const TYPED_MERGE = "merge";

/** What is written in a review: each challenge by its line, and the changes. */
interface Written {
	challenges: Record<string, Answer>;
	changes: string;
}

/**
 * A review answered by keyboard alone: it comes up in its changes box, where
 * Enter sends them, and Merge is a Tab away. What is written stays in the
 * panel, never the composer, until it is sent. It lists what the task
 * assumed, read from its `ARBOR.md` so the list is current, and a challenge
 * to one goes out with the changes, quoting its line as an answer would.
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
	const plan = useContext(Board).plans.get(review.task) ?? "";
	const challenges = assumptions(plan).map(challengeOf);
	const [written, setWritten] = useState((): Written => {
		const before = kept.read();
		return {
			challenges: Object.fromEntries(
				challenges.flatMap((asked) => {
					const answer = answerIn(before, asked);
					return answer === null ? [] : [[asked.text, answer]];
				}),
			),
			changes: besides(before, challenges),
		};
	});
	const replyFrom = ({ challenges: by, changes }: Written) =>
		replyOf(
			challenges,
			challenges.map((asked) => by[asked.text] ?? null),
			changes,
		);
	const write = (next: Written) => {
		setWritten(next);
		kept.write(replyFrom(next));
	};
	const challenge = (assumed: Question, answer: Answer) => {
		const { [assumed.text]: _, ...rest } = written.challenges;
		write({
			...written,
			challenges: isEmpty(answer) ? rest : { ...rest, [assumed.text]: answer },
		});
	};
	const asked = replyFrom(written).trim();
	const { refusal, attempt } = useRefusal();
	const ask = () => {
		if (asked !== "" && send !== null) {
			void attempt(send(asked), "Not sent");
		}
	};
	const box = useRef<HTMLTextAreaElement>(null);
	useArrival(send !== null, () => box.current);
	const approved =
		sent?.trim() === MERGE || sent?.trim().toLowerCase() === TYPED_MERGE;
	return (
		<CardShell
			label={`review ${review.task}`}
			Icon={GitMergeIcon}
			title="Ready to merge"
			tone="success"
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
			{/* What deciding to merge takes, in order: what changed, how to see
			it, what was assumed, what passed, and the details, folded. */}
			<div className="divide-y">
				{review.summary !== "" && <CardBody text={review.summary} />}
				{review.demo !== null && (
					<DemoSection
						demo={review.demo}
						kept={draft === null ? null : `${draft}:demo`}
						className="last:border-b-0"
					/>
				)}
				{challenges.length > 0 && (
					<AssumptionList
						assumptions={assumptions(plan)}
						answers={challenges.map((asked) =>
							sent === null
								? (written.challenges[asked.text] ?? null)
								: answerIn(sent, asked),
						)}
						live={send !== null}
						onAnswer={challenge}
						onNext={() => box.current?.focus()}
					/>
				)}
				{review.checks.length > 0 && <Checks checks={review.checks} />}
				{review.details !== "" && <Details text={review.details} />}
			</div>
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
						value={written.changes}
						placeholder="Say what to change…"
						onChange={(event) =>
							write({ ...written, changes: event.target.value })
						}
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
							// Changes or challenges written would go unsaid: merging
							// means none.
							disabled={asked !== ""}
							title={
								asked === ""
									? undefined
									: "Clear the changes and challenges to merge"
							}
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

/** The checks a review says passed, a line each. */
function Checks({ checks }: { checks: string[] }): JSX.Element {
	return (
		<section aria-label="Checks" className="flex flex-col gap-1 px-4 py-3">
			<h3 className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
				Checks
			</h3>
			<ul className="flex flex-col gap-1">
				{checks.map((check) => (
					<li key={check} className="flex items-center gap-2 text-sm">
						<CheckIcon
							aria-label="passed"
							className="size-3.5 shrink-0 text-success"
							strokeWidth={3}
						/>
						<code className="min-w-0 truncate font-mono text-[13px]">
							{check}
						</code>
					</li>
				))}
			</ul>
		</section>
	);
}

/** Whatever else a review says past its summary, closed until opened. */
function Details({ text }: { text: string }): JSX.Element {
	return (
		<Collapsible
			render={<section aria-label="Details" />}
			className="group/details"
		>
			<CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2.5 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
				<ChevronRightIcon className="size-3.5 transition-transform duration-150 group-data-[open]/details:rotate-90" />
				Details
			</CollapsibleTrigger>
			<CollapsibleContent>
				<CardBody text={text} className="pt-0" />
			</CollapsibleContent>
		</Collapsible>
	);
}

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
