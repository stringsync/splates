import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type { ConversationState } from "@splates/server/conversations";
import type { Details } from "@splates/server/tasks";
import { useReactive } from "core/react";
import {
	type JSX,
	memo,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Thread as ThreadView } from "#web/components/assistant-ui/elements/thread.aui.tsx";
import { Dialog } from "#web/components/ui/dialog.tsx";
import { Composing } from "#web/composing.tsx";
import { cn } from "#web/lib/utils.ts";
import { useWidgets, WIDGETS_ROOM, Widgets } from "./actions";
import { useAged } from "./aged";
import { FailedUI } from "./agent-failed";
import { AgentQueuedUI } from "./agent-queued-card";
import { AgentWaitBar } from "./agent-wait-bar";
import {
	ArchiveBar,
	ArchiveConversation,
	ArchiveOfferProvider,
	endedReport,
	useArchiveOffer,
} from "./archive-offer";
import { ArchivedBanner } from "./archived-banner";
import {
	consumeQueuedTarget,
	toWaiting,
	useArrived,
	useQueuedTarget,
} from "./arrivals";
import { ArtifactViewer } from "./artifact-open";
import { ArtifactsCard } from "./artifacts-card";
import { AskPanel } from "./ask-panel";
import { AssumedUI } from "./assumed-line";
import { BackgroundCard, BackgroundUI } from "./background";
import { BlockedPanel } from "./blocked-panel";
import { ReplyContext } from "./card-reply";
import { ChainBanner, ChainProvider } from "./chain-card";
import { useReply, useTyped } from "./composer-drafts";
import {
	useCommands,
	useFileMentions,
	useNamed,
	useProjects,
	useRecSessions,
} from "./composer-triggers";
import { NEW } from "./conversation-address";
import { markRead } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { useNameOf } from "./conversation-names";
import { HiddenTalkTask } from "./directives";
import type { Drafts } from "./drafts";
import { EvalRuns, EvalRunUI } from "./eval-live-card";
import { EventUI } from "./event-lines";
import { useTouch } from "./hooks/use-touch";
import { IdleBanner } from "./idle-banner";
import {
	ImagePreviewsContext,
	useConversationImagePreviews,
} from "./image-previews";
import { NamedContext } from "./mentioned";
import { MergeCardContext } from "./merge-card";
import { newestMerges, supersededMerges } from "./merge-events";
import { QuestionsUI } from "./message-questions";
import { livePage } from "./page-kill";
import { PermissionUI } from "./permission-card";
import { NeedsYouBar, PhoneSheets } from "./phone-sheets";
import { EdgeSwipe } from "./phone-swipe";
import { ProbeCards, ProbeUI } from "./probe-card";
import { QueueSummaryFor } from "./queue-summary-card";
import { heldEdits, queueKeyDown, useQueueEdits } from "./queued";
import { useQueuedTaskInThread } from "./queued-task";
import { QuotaCard } from "./quota-card";
import { QuotaHandoffBar } from "./quota-handoff-bar";
import { useReferences } from "./references";
import { ReferencesCard } from "./references-card";
import { Refusal } from "./refusal";
import { ReportUI } from "./report-cards";
import { ReviewUI } from "./review-panel";
import { heldAfter, queuesNow } from "./sending";
import { SignalUI, SignalWaits } from "./signal-card";
import { QueueBanner } from "./start-queue";
import { StepsConversation, StepsUI } from "./steps-card";
import { Task } from "./task-dialog";
import { useThreadActions } from "./thread-actions";
import { ThreadControls } from "./thread-controls";
import { ThreadHeader, useWhereAction } from "./thread-header";
import { useThreadHistory } from "./thread-history";
import { useThreadMessages } from "./thread-messages";
import { useThreadRuntime } from "./thread-runtime";
import { PendingRow, UnsentActionsContext } from "./unsent";
import { WaitBar, WaitSight } from "./wait-bar";
import {
	CompactionUI,
	InterruptedUI,
	StoppedUI,
	TreesContext,
	WorkUI,
} from "./work-row";

/** A conversation's page: its messages and the composer to reply in. ⌥⌘⌫ archives it. */
export const Thread = memo(function Thread(
	props: Parameters<typeof Conversation>[0],
): JSX.Element {
	const history = useThreadHistory(props.conversation, props.feed);
	const { conversation } = history;
	return (
		<Conversation
			{...props}
			conversation={conversation}
			historyFailure={history.failure}
		/>
	);
});

function Conversation({
	drafts,
	conversation,
	feed,
	agent,
	task,
	tasks,
	free,
	trunk,
	refusal,
	refuseIn,
	onLeft,
	onOpen,
	onBack,
	historyFailure,
}: {
	/** What was typed and not sent, by conversation. */
	drafts: Drafts;
	conversation: ConversationState;
	/**
	 * What it is fed by, holding a message on its way while the agent starts
	 * or resumes, to be answered as soon as it is up.
	 */
	feed: ConversationFeed;
	/** The agent's name. */
	agent: string;
	/** The task it runs in; null in the main tree, or once the task is gone. */
	task: Details | null;
	/** Every live task, for `#` to offer. */
	tasks: Details[];
	/** The tasks it can take up from the main tree. */
	free: Details[];
	/** The main tree's branch. */
	trunk: string;
	/** A write to it the server refused, said above the composer for a moment. */
	refusal: string | null;
	refuseIn: (id: string, title: string, error: unknown) => void;
	/**
	 * Once it is archived, to go on to what ⌥⌘M would open, or a new
	 * conversation with none.
	 */
	onLeft: () => void;
	onOpen: (id: string) => void;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
	historyFailure?: React.ReactNode;
}): JSX.Element {
	const { id, archived, summary } = conversation;
	const refused = useCallback(
		(title: string, error: unknown) => refuseIn(id, title, error),
		[refuseIn, id],
	);
	const queuedTarget = useQueuedTarget(id);
	const thread = useThreadMessages(conversation, feed, queuedTarget);
	const held = conversation.messages.length;
	// What a reload after a kill reports: which conversation was open, how big.
	useEffect(() => {
		livePage.open(id, held);
		return () => livePage.open(null, null);
	}, [id, held]);
	const { queued, asking } = thread;
	// Nothing to tell anyone: the next scroll tries again.
	const onRead = useCallback(
		(read: number) => void markRead(id, read).catch(() => {}),
		[id],
	);
	const {
		runtime,
		stopping,
		send,
		retry,
		edit: editUnsent,
	} = useThreadRuntime(conversation, feed, drafts, thread, refused);
	const unsent = useReactive(feed, (feed) => feed.unsent.get(id), ["changed"]);
	const sending = useReactive(feed, (feed) => feed.sending.get(id), [
		"changed",
	]);
	const { aged: agedSending } = useAged(
		feed,
		sending ?? [],
		(each) => each.at,
		heldAfter(queuesNow(conversation)),
	);
	const unsentActions = useMemo(
		() => ({
			retry: (message: string) => {
				const found = unsent?.find((each) => each.message.id === message);
				if (found !== undefined) {
					retry(found.message);
				}
			},
			edit: (message: string) => {
				const found = unsent?.find((each) => each.message.id === message);
				if (found !== undefined) {
					editUnsent(found.message);
				}
			},
		}),
		[unsent, retry, editUnsent],
	);
	const superseded = useMemo(
		() => supersededMerges(conversation.events),
		[conversation.events],
	);
	const newest = useMemo(
		() => newestMerges(conversation.events),
		[conversation.events],
	);
	const mergeCard = useMemo(
		() => ({
			conversation: id,
			task,
			tasks,
			superseded,
			newest,
			archiveAfterMerge: conversation.archiveAfterMerge === true,
		}),
		[id, task, tasks, superseded, newest, conversation.archiveAfterMerge],
	);
	const section = useRef<HTMLElement>(null);
	const reply = useReply(id, drafts, send);
	const typed = useTyped(runtime);
	const { adapter: mentions, paths } = useFileMentions(conversation.task);
	const commands = useCommands(conversation.commands);
	const {
		sendNow,
		edit,
		discard,
		busy: queueBusy,
	} = useQueueEdits(id, runtime, section, refused);
	const touch = useTouch();
	const { actions, archive } = useThreadActions(
		conversation,
		task,
		refused,
		onLeft,
	);
	const [details, setDetails] = useState(false);
	const where = useWhereAction({
		conversation,
		task,
		free,
		trunk,
		onTake: (text) => void send(text, []).catch(() => {}),
		onDetails: () => setDetails(true),
	});
	// The newest card it waits on you through, which also focuses it. A phone
	// opens its questions and review in a sheet instead, and shows a live ask
	// at the foot of the thread it opens at, keeping the keyboard down.
	useArrived(
		onBack === null ? id : "",
		() => toWaiting(section.current),
		summary !== true,
	);
	const [arrivedTask, setArrivedTask] = useState<number | null>(null);
	useEffect(() => {
		if (queuedTarget === null || summary === true) {
			return;
		}
		setArrivedTask(queuedTarget);
		consumeQueuedTarget(id, queuedTarget);
	}, [id, queuedTarget, summary]);
	useEffect(() => {
		if (arrivedTask === null) {
			return;
		}
		const target = arrivedTask;
		const scrollToBar = () => {
			const root = section.current;
			if (root === null) {
				return;
			}
			const bar =
				[...root.querySelectorAll<HTMLElement>("[data-queued-tasks]")].find(
					(el) => el.dataset.queuedTasks?.split(",").includes(String(target)),
				) ?? root.querySelector<HTMLElement>('[aria-label="task chain"]');
			bar?.scrollIntoView?.({ block: "center", behavior: "instant" });
		};
		scrollToBar();
		const frame = requestAnimationFrame(scrollToBar);
		const timer = setTimeout(() => {
			setArrivedTask((current) => (current === target ? null : current));
		}, 2000);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(timer);
		};
	}, [arrivedTask]);
	const projects = useProjects();
	const references = useReferences(
		tasks,
		actions,
		projects ?? undefined,
		useRecSessions(),
	);
	const root = useContext(TreesContext)?.root ?? null;
	const named = useNamed(
		paths,
		projects,
		task?.worktree ?? (conversation.task === null ? root : null),
	);
	// What the conversation's last word reports, to offer archiving it when
	// the task is over.
	const archivable = !archived;
	const fileAway = () => archive.file(onLeft);
	const swipeAway = (_then?: () => void, failed?: () => void) =>
		archive.file(onLeft, failed);
	const last = archivable ? endedReport(conversation) : null;
	// A blocked task is no ending to offer archiving at: the menu does that.
	const { offer, barred } = useArchiveOffer(
		last?.ending === "deferred" ? null : last,
		fileAway,
	);
	const widgets = useWidgets(section);
	const imagePreviews = useConversationImagePreviews(id);
	const nameOf = useNameOf();
	const queuedTask = useQueuedTaskInThread(conversation, refused);
	return (
		<>
			{onBack !== null && archivable && (
				<EdgeSwipe
					archive={{ asks: archive.asks, file: swipeAway }}
					target={section}
				/>
			)}
			<section
				ref={section}
				aria-label={nameOf(conversation)}
				// Up takes back the last queued message. Enter with nothing typed
				// sends the queue now; with something typed, it queues that instead.
				onKeyDownCapture={(event) =>
					queueKeyDown(event, runtime, {
						queued,
						running: conversation.status === "running",
						pending: sending !== undefined,
						touch,
						sendNow,
						edit,
					})
				}
				// Fills the inset panel on desktop or the screen on a phone.
				className={cn(
					"@container flex min-h-0 min-w-0 flex-1 flex-col bg-background",
					onBack === null ? "gap-3" : "gap-1",
				)}
			>
				<ThreadHeader
					conversation={conversation}
					refused={refused}
					widgets={widgets}
					extraActions={queuedTask.actions}
					// With the same agent, in the main tree: a task's tree is its own.
					onNew={() => onOpen(`${NEW}/${conversation.agent}`)}
					onBack={onBack}
				/>
				{archived && <ArchivedBanner key={id} phone={onBack !== null} />}
				{archive.confirm}
				{task !== null && (
					<Dialog open={details} onOpenChange={setDetails}>
						{details && <Task task={task} />}
					</Dialog>
				)}
				{!archived &&
					conversation.queue === null &&
					conversation.status === "stopped" &&
					conversation.stoppedIdle !== null && (
						<IdleBanner phone={onBack !== null} />
					)}
				{conversation.queue !== null && (
					<QueueBanner
						id={conversation.id}
						spot={conversation.queue}
						held={conversation.heldForTask}
						phone={onBack !== null}
					/>
				)}
				<ImagePreviewsContext value={imagePreviews.expanded}>
					<Composing.Provider value={runtime.thread.composer}>
						<ArtifactViewer
							conversation={conversation.id}
							artifacts={conversation.artifacts}
						>
							<PhoneSheets
								conversation={id}
								on={onBack !== null}
								whole={summary !== true}
							>
								<div
									className="relative min-h-0 flex-1"
									style={{
										["--thread-inset-end" as string]:
											widgets.roomy && widgets.open ? WIDGETS_ROOM : "0px",
									}}
								>
									<MergeCardContext value={mergeCard}>
										<SignalWaits
											value={{ conversation: id, waits: conversation.signals }}
										>
											<ProbeCards value={conversation.probes ?? []}>
												<EvalRuns
													value={{
														conversation: id,
														runs: conversation.evals ?? [],
													}}
												>
													<WaitSight>
														<AssistantRuntimeProvider runtime={runtime}>
															<QueueSummaryFor value={conversation}>
																<QuestionsUI />
																<ReviewUI />
																<ReportUI />
																<PermissionUI />
																<AgentQueuedUI />
																<StepsUI />
																<WorkUI />
																<EventUI />
																<AssumedUI />
																<StoppedUI />
																<CompactionUI />
																<BackgroundUI />
																<SignalUI />
																<ProbeUI />
																<EvalRunUI />
																<InterruptedUI />
																<FailedUI />
																<StepsConversation value={id}>
																	<ArchiveConversation
																		value={archivable ? fileAway : null}
																	>
																		<ArchiveOfferProvider value={offer}>
																			<UnsentActionsContext
																				value={unsentActions}
																			>
																				<ReplyContext value={reply}>
																					<NamedContext value={named}>
																						<HiddenTalkTask
																							value={queuedTask.todoId}
																						>
																							<ChainProvider
																								conversation={id}
																								active={summary !== true}
																								arrivedTask={arrivedTask}
																								onOpen={onOpen}
																							>
																								<ThreadView
																									agent={{
																										id: conversation.agent,
																										name: agent,
																									}}
																									docked
																									occupied={
																										(sending?.length ?? 0) >
																											0 || queued.length > 0
																									}
																									historyFailure={
																										historyFailure
																									}
																									onRead={onRead}
																									autoFocus={
																										summary !== true &&
																										(!asking || typed)
																									}
																									stopping={stopping}
																									mentions={
																										mentions ?? undefined
																									}
																									references={references}
																									commands={
																										commands ?? undefined
																									}
																									placeholder={
																										archived
																											? "Send a message to unarchive and continue"
																											: undefined
																									}
																									welcome={
																										queuedTask.todoId === null
																											? undefined
																											: null
																									}
																									before={
																										<>
																											{summary !== true && (
																												<ChainBanner
																													conversation={id}
																													onOpen={onOpen}
																												/>
																											)}
																											{queuedTask.before}
																										</>
																									}
																									controls={
																										<ThreadControls
																											conversation={
																												conversation
																											}
																											refused={refused}
																										/>
																									}
																									after={
																										<BlockedPanel
																											conversation={
																												conversation
																											}
																										/>
																									}
																									above={
																										<>
																											{queuedTask.signal}
																											<NeedsYouBar />
																											<WaitBar />
																											<AgentWaitBar />
																											<Refusal
																												refusal={refusal}
																												className="px-2"
																											/>
																											{offer !== null &&
																												barred && (
																													<ArchiveBar
																														offer={offer}
																													/>
																												)}
																											<QuotaHandoffBar
																												conversation={
																													conversation
																												}
																												agent={agent}
																												feed={feed}
																												refused={refused}
																											/>
																											<PendingRow
																												messages={agedSending}
																												held={queued}
																												edits={heldEdits(
																													conversation,
																													{
																														sendNow,
																														edit,
																														discard,
																														busy: queueBusy,
																													},
																												)}
																											/>
																											{conversation.ask !==
																												null && (
																												<AskPanel
																													key={
																														conversation.ask.id
																													}
																													drafts={drafts}
																													conversation={
																														conversation
																													}
																													agent={agent}
																													ask={conversation.ask}
																												/>
																											)}
																										</>
																									}
																								/>
																							</ChainProvider>
																						</HiddenTalkTask>
																					</NamedContext>
																				</ReplyContext>
																			</UnsentActionsContext>
																		</ArchiveOfferProvider>
																	</ArchiveConversation>
																</StepsConversation>
															</QueueSummaryFor>
														</AssistantRuntimeProvider>
													</WaitSight>
												</EvalRuns>
											</ProbeCards>
										</SignalWaits>
									</MergeCardContext>
									<Widgets
										phone={onBack !== null}
										roomy={widgets.roomy}
										open={widgets.open}
										onClose={widgets.close}
										actions={where === null ? actions : [where, ...actions]}
									>
										<QuotaCard
											conversation={conversation}
											agent={agent}
											feed={feed}
											open={widgets.open}
										/>
										<BackgroundCard
											conversation={id}
											background={conversation.background}
										/>
										<ArtifactsCard
											conversation={id}
											artifacts={conversation.artifacts}
										/>
										<ReferencesCard conversation={conversation} />
									</Widgets>
								</div>
							</PhoneSheets>
						</ArtifactViewer>
					</Composing.Provider>
				</ImagePreviewsContext>
			</section>
		</>
	);
}
