import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import { useReactive, useResource } from "@webappwiz/react";
import {
	CheckIcon,
	ChevronRightIcon,
	GitMergeIcon,
	SendHorizontalIcon,
	XIcon,
} from "lucide-react";
import { type JSX, useContext, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#dev/components/ui/collapsible.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { focusStop, useTouch } from "#dev/hooks/use-touch.ts";
import type { Review } from "../asked";
import { assumptions } from "../plan";
import { MERGE } from "../prompts";
import { answerIn } from "../reply";
import { ArborEvent } from "./arbor-event";
import {
	AssumptionList,
	AssumptionsChanged,
	useChallenges,
} from "./assumption-list";
import { Board } from "./board";
import { BoxFiles } from "./box-files";
import { CardBox } from "./card-box";
import { InMessage, useArrival, useCardReply, useKept } from "./card-reply";
import { CardBody, CardShell } from "./card-shell";
import { DemoSection } from "./demo-cards";
import { Markdown } from "./markdown";
import { Sheeted } from "./phone-sheets";
import { Refusal, useRefusal } from "./refusal";

/** The name of a review's changes box among its boxes. */
const CHANGES = "changes";

/** What a reply typed by hand says to merge, as the review's last line asks. */
const TYPED_MERGE = "merge";

/**
 * A review answered by keyboard alone: it comes up in its changes box, where
 * Enter sends them, and Merge is a Tab away while the box is empty. It shows
 * one button, Merge or Send, as the box is empty or not. What is written stays in the
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
	const touch = useTouch();
	const {
		assumptions: assumed,
		answers,
		changes,
		setChanges,
		challenge,
		reply: asked,
		changed,
		dropped,
		reload,
	} = useChallenges(assumptions(plan), kept);
	const { refusal, attempt } = useRefusal();
	// What is attached to the changes, which go with them.
	const files = useResource(() => new BoxFiles(), []);
	const attached = useReactive(files, (each) => each.any, ["changed"]);
	const ask = () => {
		if ((asked !== "" || attached) && send !== null) {
			const out = files.out([{ name: CHANGES, text: asked }]);
			void attempt(
				send(out.texts[0] ?? "", out.files).then(() => files.clear()),
				"Not sent",
			);
		}
	};
	const box = useRef<HTMLDivElement>(null);
	useArrival(send !== null, () => box.current);
	const approved =
		sent?.trim() === MERGE || sent?.trim().toLowerCase() === TYPED_MERGE;
	// Approved, it is history: a line of arbor's, the Merged report below
	// it the one card that says how the task ended. Show opens it again.
	const [shown, setShown] = useState(false);
	const card = (
		<CardShell
			label={`review ${review.task}`}
			Icon={GitMergeIcon}
			title="Ready to merge"
			tone={approved ? "neutral" : "success"}
			task={review.task}
			base={review.base}
			folded={sent !== null && !approved}
			aside={
				sent === null || approved ? undefined : (
					<span className="text-muted-foreground text-xs">Changes asked</span>
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
				{assumed.length > 0 && (
					<AssumptionList
						assumptions={assumed}
						answers={
							sent === null
								? answers
								: assumed.map((asked) => answerIn(sent, asked))
						}
						live={send !== null}
						onAnswer={challenge}
						onNext={() => focusStop(box.current)}
					/>
				)}
				{review.checks.length + review.failed.length > 0 && (
					<Checks passed={review.checks} failed={review.failed} />
				)}
				{review.details !== "" && <Details text={review.details} />}
			</div>
			{sent !== null && !approved && (
				// What the person replied, as it was sent: the card keeps it.
				<footer className="flex items-start gap-2 border-t bg-muted/20 px-4 py-3 text-sm">
					<span className="shrink-0 text-muted-foreground">Asked for</span>
					<Markdown
						text={sent}
						className="min-w-0 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
					/>
				</footer>
			)}
			{send !== null && (
				<footer className="flex flex-col gap-2.5 border-t bg-muted/20 px-4 py-3">
					<CardBox
						ref={box}
						aria-label={`Changes to ${review.task}`}
						value={changes}
						placeholder="Say what to change…"
						onValue={setChanges}
						files={files.of(CHANGES)}
						onKeyDown={(event) => {
							// Enter sends, as in the composer; Shift+Enter is a new line.
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								ask();
							}
						}}
						className="min-h-9 pointer-coarse:min-h-11"
					/>
					<div className="flex items-center gap-2 pointer-coarse:[&_button]:h-10 pointer-coarse:[&_button]:px-3">
						{changed ? (
							<AssumptionsChanged
								dropped={dropped}
								onReload={reload}
								className="flex-1"
							/>
						) : (
							<p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
								{!touch &&
									(asked === "" ? (
										<span>
											<Kbd>Tab</Kbd> to merge
										</span>
									) : (
										<span>
											<Kbd>↵</Kbd> sends changes
										</span>
									))}
							</p>
						)}
						{/* One button, for what the box holds: written changes or
						challenges go out as they are, and nothing written merges. */}
						{asked === "" && !attached ? (
							<Button
								size="sm"
								onClick={() => void attempt(send(MERGE), "Not sent")}
								className="bg-success text-white hover:bg-success/90"
							>
								<GitMergeIcon data-icon="inline-start" />
								Merge
							</Button>
						) : (
							<Button size="sm" onClick={ask}>
								<SendHorizontalIcon data-icon="inline-start" />
								Send
							</Button>
						)}
					</div>
					<Refusal refusal={refusal} className="text-right" />
				</footer>
			)}
		</CardShell>
	);
	if (!approved) {
		return card;
	}
	return (
		<div className="my-6">
			<ArborEvent
				event={{
					words: ["Review approved", { kind: "task", task: review.task }],
					act: { label: shown ? "Hide" : "Show", run: () => setShown(!shown) },
				}}
			/>
			{shown && card}
		</div>
	);
}

/**
 * The checks a review ran, closed until opened: its title says whether they
 * all passed, and opened, each one's line says.
 */
function Checks({
	passed,
	failed,
}: {
	passed: string[];
	failed: string[];
}): JSX.Element {
	const ran = [
		...failed.map((check) => ({ check, passed: false })),
		...passed.map((check) => ({ check, passed: true })),
	];
	return (
		<Collapsible
			render={<section aria-label="Checks" />}
			className="group/checks"
		>
			<CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2.5 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
				<ChevronRightIcon className="size-3.5 transition-transform duration-150 group-data-[open]/checks:rotate-90" />
				Checks
				<Outcome passed={failed.length === 0} />
			</CollapsibleTrigger>
			<CollapsibleContent>
				<ul className="flex flex-col gap-1 px-4 pb-3">
					{ran.map(({ check, passed }) => (
						<li key={check} className="flex items-center gap-2 text-sm">
							<Outcome passed={passed} />
							<code className="min-w-0 truncate font-mono text-[13px]">
								{check}
							</code>
						</li>
					))}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	);
}

/** A green check for passed, a red x for failed. */
function Outcome({ passed }: { passed: boolean }): JSX.Element {
	return passed ? (
		<CheckIcon
			aria-label="passed"
			className="size-3.5 shrink-0 text-success"
			strokeWidth={3}
		/>
	) : (
		<XIcon
			aria-label="failed"
			className="size-3.5 shrink-0 text-destructive"
			strokeWidth={3}
		/>
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
export function MessageReview({ review }: { review: Review }): JSX.Element {
	const message = useAuiState((state) => state.message.id);
	return (
		<Sheeted title="Ready to merge" Icon={GitMergeIcon} tone="success">
			<ReviewPanel review={review} draft={`review:${message}`} />
		</Sheeted>
	);
}
