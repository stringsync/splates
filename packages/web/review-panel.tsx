import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import type { Review } from "@splates/server/plans";
import { directive, MERGE, replyOf } from "@splates/server/plans/browser";
import { useReactive, useResource } from "core/react";
import { GitMergeIcon, SendHorizontalIcon } from "lucide-react";
import { type JSX, useContext, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { useTouch } from "#web/hooks/use-touch.ts";
import { BeforeAfter, cardRecord } from "./before-after";
import { BoxFiles } from "./box-files";
import { CardBox, useBoxTaking, useCardDictationTurn } from "./card-box";
import { InMessage, useArrival, useCardReply, useKept } from "./card-reply";
import { CardBody, CardShell } from "./card-shell";
import { DemoSection } from "./demo-cards";
import { useEnterWhileTaking } from "./enter-while-taking";
import { Markdown } from "./markdown";
import { MergeCardContext } from "./merge-card";
import { Sheeted } from "./phone-sheets";
import { Refusal, useRefusal } from "./refusal";
import { SplatesEvent } from "./splates-event";

/** The name of a review's changes box among its boxes. */
const CHANGES = "changes";

/** What a reply typed by hand says to merge, as the review's last line asks. */
const TYPED_MERGE = "merge";

/**
 * A review for the person to merge or ask changes of. Pass the review and a
 * way to send the reply; the panel keeps what is typed until it is sent.
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
	const touch = useTouch();
	// Kept as it is written, so leaving and coming back loses nothing.
	const [changes, setWritten] = useState(() => kept.read());
	const setChanges = (text: string) => {
		setWritten(text);
		kept.write(text);
	};
	const asked = replyOf([], [], changes);
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
	const footer = useRef<HTMLElement>(null);
	const finishThen = useCardDictationTurn(footer);
	const taking = useBoxTaking();
	// A take under way sends once it is done, from the render that holds its
	// words: the click's own `ask` reads the box from before them.
	const [sendTaken, setSendTaken] = useState(false);
	useEffect(() => {
		if (sendTaken) {
			setSendTaken(false);
			ask();
		}
	});
	// Enter mid-dictation lands on the bare page: finish the take, then send.
	useEnterWhileTaking(send !== null, () => {
		if (footer.current?.querySelector("[data-dictation-owner]") == null) {
			return false;
		}
		finishThen(() => setSendTaken(true));
		return true;
	});
	useArrival(send !== null, () => box.current);
	const approved =
		(typeof sent === "string" && directive(sent) === MERGE) ||
		sent?.trim().toLowerCase() === TYPED_MERGE;
	// Approved, it is history: a line of splates's, the Merged report below
	// it the one card that says how the task ended. Show opens it again.
	const [shown, setShown] = useState(false);
	const live = useContext(MergeCardContext)?.tasks.find(
		(each) => each.task === review.task,
	);
	const record = cardRecord(live?.plan);
	const prose = (
		<>
			{review.summary !== "" && <CardBody text={review.summary} />}
			{review.demo !== null && (
				<DemoSection demo={review.demo} className="last:border-b-0" />
			)}
		</>
	);
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
			{/* What deciding to merge takes, in order: the change as its record
			has it, what passed, and the prose. A task with no record left, as
			an older review's, keeps the prose open. */}
			<div className="divide-y">
				{record === null ? (
					<>
						{prose}
						{review.details !== "" && <CardBody text={review.details} />}
					</>
				) : (
					<>
						<BeforeAfter
							record={record}
							className="px-4 py-3.5 @max-md:px-3 @max-md:py-2.5"
						/>
						{(review.summary !== "" ||
							review.demo !== null ||
							review.details !== "") && (
							<>
								{prose}
								{review.details !== "" && <CardBody text={review.details} />}
							</>
						)}
					</>
				)}
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
				<footer
					ref={footer}
					className="flex flex-col gap-2.5 border-t bg-muted/20 px-4 py-3"
				>
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
					<div className="flex items-center gap-2">
						<p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs in-data-sheet:hidden">
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
						{/* One button, for what the box holds: written changes go
						out as they are, and nothing written merges, unless a take is
						under way, whose words will be changes. */}
						{asked === "" && !attached && !taking ? (
							<Button
								size="sm"
								onClick={() => void attempt(send(MERGE), "Not sent")}
								className="bg-success text-white hover:bg-success/90 in-data-sheet:flex-1 pointer-coarse:h-11 pointer-coarse:px-4 pointer-coarse:text-base"
							>
								<GitMergeIcon data-icon="inline-start" />
								Merge
							</Button>
						) : (
							<Button
								size="sm"
								onClick={() => finishThen(() => setSendTaken(true))}
								className="in-data-sheet:flex-1 pointer-coarse:h-11 pointer-coarse:px-4 pointer-coarse:text-base"
							>
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
			<SplatesEvent
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
 * Shows a `data-review` part in a thread as a review panel, apart from
 * questions. Merge, or what to change, is sent from the panel itself.
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
