import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { TaskReport } from "@stringsync/splates-server/plans";
import type { Event } from "@stringsync/splates-server/records";
import { isEscalation } from "@stringsync/splates-server/records/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { ArchiveIcon, XIcon } from "lucide-react";
import {
	type JSX,
	memo,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import { Thread as ThreadView } from "#web/components/assistant-ui/elements/thread.aui.tsx";
import { Dialog } from "#web/components/ui/dialog.tsx";
import { Composing } from "#web/composing.tsx";
import { cn } from "#web/lib/utils.ts";
import { useWidgets, WIDGETS_ROOM, Widgets } from "./actions";
import {
	ArchiveBar,
	ArchiveConversation,
	ArchiveOfferProvider,
	useArchiveOffer,
} from "./archive-offer";
import { toWaiting, useArrived } from "./arrivals";
import { ArtifactViewer } from "./artifact-open";
import { ArtifactsCard } from "./artifacts-card";
import { AskPanel } from "./ask-panel";
import { BackgroundCard, BackgroundUI } from "./background";
import { ReplyContext } from "./card-reply";
import { useReply, useTyped } from "./composer-drafts";
import {
	useCommands,
	useFileMentions,
	useNamed,
	useProjects,
} from "./composer-triggers";
import { NEW } from "./conversation-address";
import { approveSuite, markRead } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { lastReport, useNameOf } from "./conversation-names";
import { CurrentTask, TaskRegistry } from "./current-task";
import { DemoUI } from "./demo-cards";
import type { Drafts } from "./drafts";
import { bleed, ErrorBanner } from "./error-banner";
import { EvalsConversation } from "./evals-card";
import { EventUI } from "./event-lines";
import { tierOf } from "./event-tier";
import { IdleBanner } from "./idle-banner";
import { NamedContext } from "./mentioned";
import { MergeCardContext } from "./merge-card";
import { QuestionsUI } from "./message-questions";
import { PermissionUI } from "./permission-card";
import { NeedsYouBar, PhoneSheets } from "./phone-sheets";
import { EdgeSwipe } from "./phone-swipe";
import { useTakeBack } from "./queued";
import { GoingUI, QueuedUI } from "./queued-time";
import { useReferences } from "./references";
import { ReferencesCard } from "./references-card";
import { Refusal } from "./refusal";
import { ReportUI, StartNewContext, TodoUI } from "./report-cards";
import { ReviewUI } from "./review-panel";
import { SuiteGrant } from "./run-command-card";
import { QueueBanner } from "./slot-queue";
import { Task } from "./task-dialog";
import { useThreadActions } from "./thread-actions";
import { ThreadControls } from "./thread-controls";
import { ThreadHeader, useWhereAction } from "./thread-header";
import { useThreadHistory } from "./thread-history";
import { useThreadMessages } from "./thread-messages";
import { useThreadRuntime } from "./thread-runtime";
import { BELOW_BAR } from "./top-bar";
import { UnsentContext } from "./unsent";
import {
	CompactionUI,
	InterruptedUI,
	RestedUI,
	StoppedUI,
	TreesContext,
	WorkUI,
} from "./work-row";

/**
 * Shows one conversation, with the agent's questions above its composer.
 * ⌥⌘⌫ (Ctrl+Alt+Backspace off a Mac) archives it; only Unarchive brings it
 * back. Open an artifact from the card beside the conversation or a line in it.
 */
export const Thread = memo(function Thread(
	props: Parameters<typeof Conversation>[0],
): JSX.Element {
	const history = useThreadHistory(props.conversation, props.feed);
	const { conversation } = history;
	return (
		<ArtifactViewer
			conversation={conversation.id}
			artifacts={conversation.artifacts}
		>
			<Conversation
				{...props}
				conversation={conversation}
				historyFailure={history.failure}
			/>
		</ArtifactViewer>
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
	const thread = useThreadMessages(conversation, feed);
	const { queued, asking, going } = thread;
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
	const suite = useMemo(() => () => approveSuite(id), [id]);
	const unsentActions = useMemo(
		() => ({ unsent: unsent ?? [], retry, edit: editUnsent }),
		[unsent, retry, editUnsent],
	);
	const superseded = useMemo(
		() => supersededMerges(conversation.events),
		[conversation.events],
	);
	const mergeCard = useMemo(
		() => ({ conversation: id, task, superseded }),
		[id, task, superseded],
	);
	const section = useRef<HTMLElement>(null);
	const reply = useReply(id, drafts, send);
	const typed = useTyped(runtime);
	const { adapter: mentions, paths } = useFileMentions(conversation.task);
	const commands = useCommands(conversation.commands);
	const edit = useTakeBack(id, runtime, section, refused);
	const { actions, archive, startNew } = useThreadActions(
		conversation,
		task,
		drafts,
		refused,
		onLeft,
		onOpen,
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
	const projects = useProjects();
	const references = useReferences(tasks, actions, projects ?? undefined);
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
	const { offer, barred } = useArchiveOffer(
		archivable ? ended(conversation) : null,
		fileAway,
	);
	const widgets = useWidgets(section);
	const nameOf = useNameOf();
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
				// Up in an empty composer takes back the last queued message, as a
				// terminal brings back the last command.
				onKeyDownCapture={(event) => {
					const box = event.target as HTMLElement;
					const last = queued.at(-1);
					if (
						event.key === "ArrowUp" &&
						box.getAttribute("aria-label") === "Message input" &&
						runtime.thread.composer.getState().text === "" &&
						last !== undefined &&
						// The last one is still on its way, with nothing to take back.
						feed.unrecorded(id) === 0
					) {
						event.preventDefault();
						void edit(queued.length - 1, last);
					}
				}}
				// A phone's fills the screen; beside a sidebar, the pane's padding.
				className={cn(
					"@container flex min-h-0 min-w-0 flex-col bg-background",
					onBack === null ? cn(BELOW_BAR, "gap-3") : "h-full gap-1",
				)}
			>
				<ThreadHeader
					conversation={conversation}
					refused={refused}
					widgets={widgets}
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
				{conversation.error !== null && (
					<ErrorBanner
						conversation={conversation}
						error={conversation.error}
						phone={onBack !== null}
					/>
				)}
				{conversation.status === "stopped" &&
					conversation.stoppedIdle !== null && (
						<IdleBanner phone={onBack !== null} />
					)}
				{conversation.queue !== null && (
					<QueueBanner
						id={conversation.id}
						spot={conversation.queue}
						held={conversation.queued}
						phone={onBack !== null}
					/>
				)}
				<PhoneSheets
					conversation={id}
					on={onBack !== null}
					whole={summary !== true}
				>
					<TaskRegistry>
						{(version) => (
							<div
								className="relative min-h-0 flex-1"
								style={{
									["--thread-inset-end" as string]:
										widgets.roomy && widgets.open ? WIDGETS_ROOM : "0px",
								}}
							>
								<MergeCardContext value={mergeCard}>
									<AssistantRuntimeProvider runtime={runtime}>
										<Composing.Provider value={runtime.thread.composer}>
											<UnsentContext.Provider value={unsentActions}>
												<QuestionsUI />
												<ReviewUI />
												<ReportUI />
												<TodoUI />
												<PermissionUI />
												<DemoUI />
												<WorkUI />
												<QueuedUI />
												<GoingUI />
												<EventUI />
												<StoppedUI />
												<CompactionUI />
												<BackgroundUI />
												<RestedUI />
												<InterruptedUI />
												<EvalsConversation value={id}>
													<SuiteGrant value={suite}>
														<ArchiveConversation
															value={archivable ? fileAway : null}
														>
															<ArchiveOfferProvider value={offer}>
																<StartNewContext value={startNew}>
																	<ReplyContext value={reply}>
																		<NamedContext value={named}>
																			<ThreadView
																				docked
																				historyFailure={historyFailure}
																				onRead={onRead}
																				autoFocus={
																					summary !== true && (!asking || typed)
																				}
																				stopping={stopping}
																				going={going}
																				mentions={mentions ?? undefined}
																				references={references}
																				commands={commands ?? undefined}
																				placeholder={
																					archived
																						? "Send a message to unarchive and continue"
																						: undefined
																				}
																				controls={
																					<ThreadControls
																						conversation={conversation}
																						refused={refused}
																					/>
																				}
																				above={
																					<>
																						<NeedsYouBar />

																						<Refusal
																							refusal={refusal}
																							className="px-2"
																						/>
																						{offer !== null && barred && (
																							<ArchiveBar offer={offer} />
																						)}
																						{conversation.ask !== null && (
																							<AskPanel
																								key={conversation.ask.id}
																								drafts={drafts}
																								conversation={conversation}
																								agent={agent}
																								ask={conversation.ask}
																							/>
																						)}
																					</>
																				}
																			/>
																		</NamedContext>
																	</ReplyContext>
																</StartNewContext>
															</ArchiveOfferProvider>
														</ArchiveConversation>
													</SuiteGrant>
												</EvalsConversation>
											</UnsentContext.Provider>
										</Composing.Provider>
									</AssistantRuntimeProvider>
								</MergeCardContext>
								<Widgets
									phone={onBack !== null}
									roomy={widgets.roomy}
									open={widgets.open}
									onClose={widgets.close}
									actions={where === null ? actions : [where, ...actions]}
								>
									<BackgroundCard
										conversation={id}
										background={conversation.background}
									/>
									<ArtifactsCard
										conversation={id}
										artifacts={conversation.artifacts}
									/>
									<ReferencesCard conversation={conversation} />
									<CurrentTask version={version} />
								</Widgets>
							</div>
						)}
					</TaskRegistry>
				</PhoneSheets>
			</section>
		</>
	);
}

/**
 * The report that is the conversation's last word when it says the task is
 * over, and nothing splates shows in the thread came after it, such as
 * another task taken up: null otherwise.
 */
function ended(conversation: ConversationState): TaskReport | null {
	const report = lastReport(conversation);
	if (
		report === null ||
		report.ending === "escalated" ||
		report.ending === "working"
	) {
		return null;
	}
	// When the agent began saying it; a log too old to say keeps the offer.
	const reply = conversation.messages
		.at(-1)
		?.parts.findLast((part) => part.type === "text" && part.text.trim() !== "");
	const said = reply?.type === "text" ? reply.at : null;
	const movedOn =
		typeof said === "string" &&
		conversation.events.some(
			(event) =>
				event.at > said && (isEscalation(event) || tierOf(event) === "loud"),
		);
	return movedOn ? null : report;
}

/**
 * Atop an archived conversation, across the pane's padding to its edges,
 * saying so and how it comes back.
 */
function ArchivedBanner({ phone }: { phone: boolean }): JSX.Element | null {
	const [dismissed, setDismissed] = useState(false);
	if (dismissed) {
		return null;
	}
	return (
		<p
			role="status"
			className={cn(
				bleed(phone),
				"flex shrink-0 items-center justify-center gap-2 border-b bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<ArchiveIcon className="size-4 shrink-0" />
			<span>
				<span className="font-medium text-foreground">
					This conversation is archived.
				</span>{" "}
				Sending a message unarchives it.
			</span>
			<button
				type="button"
				aria-label="Dismiss"
				onClick={() => setDismissed(true)}
				className="-mr-2 shrink-0 rounded-md p-1 active:bg-background"
			>
				<XIcon className="size-4" />
			</button>
		</p>
	);
}

/** Ids of the refused merges that a later merge attempt for the same task followed. */
function supersededMerges(events: readonly Event[]): Set<string> {
	const out = new Set<string>();
	for (const event of events) {
		if (event.action === "merge" && event.reason !== null) {
			const later = events.some(
				(each) =>
					each.at > event.at &&
					each.task === event.task &&
					(each.action === "merge" ||
						each.action === "merge queued" ||
						each.action === "merge start"),
			);
			if (later) {
				out.add(event.id);
			}
		}
	}
	return out;
}
