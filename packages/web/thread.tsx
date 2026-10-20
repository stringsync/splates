import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { TaskReport } from "@stringsync/splates-server/plans";
import { isEscalation } from "@stringsync/splates-server/records/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { ArchiveIcon } from "lucide-react";
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
import {
	ArchiveBar,
	ArchiveOfferProvider,
	useArchiveOffer,
} from "./archive-offer";
import { toWaiting, useArrived } from "./arrivals";
import { ArtifactViewer } from "./artifact-open";
import { ArtifactsCard } from "./artifacts-card";
import { AskPanel } from "./ask-panel";
import { BackgroundCard, BackgroundUI, ListedBackground } from "./background";
import { ReplyContext } from "./card-reply";
import { useChooseSetting } from "./choose-setting";
import { useReply, useTyped } from "./composer-drafts";
import {
	useCommands,
	useFileMentions,
	useNamed,
	useProjects,
} from "./composer-triggers";
import { NEW } from "./conversation-address";
import { filable } from "./conversation-archive";
import type { ConversationFeed } from "./conversation-feed";
import { lastReport, useNameOf } from "./conversation-names";
import { CurrentTask, TaskRegistry } from "./current-task";
import { DemoUI } from "./demo-cards";
import type { Drafts } from "./drafts";
import { bleed, ErrorBanner } from "./error-banner";
import { EventUI, lineOf } from "./event-lines";
import { IdleBanner } from "./idle-banner";
import { NamedContext } from "./mentioned";
import { QuestionsUI } from "./message-questions";
import { NeedsYouBar, PhoneSheets } from "./phone-sheets";
import { QueueUI } from "./queue-card";
import { useTakeBack } from "./queued";
import { GoingUI, QueuedUI } from "./queued-time";
import { useReferences } from "./references";
import { Refusal } from "./refusal";
import { ReportUI, StartNewContext, TodoUI } from "./report-cards";
import { ReviewUI } from "./review-panel";
import { SettingControls } from "./setting-controls";
import { QueueBanner } from "./slot-queue";
import { Task } from "./task-dialog";
import { useThreadActions } from "./thread-actions";
import { ThreadHeader, useWhereAction } from "./thread-header";
import { useThreadMessages } from "./thread-messages";
import { useThreadRuntime } from "./thread-runtime";
import { BELOW_BAR } from "./top-bar";
import { UnsentContext } from "./unsent";
import { ContextMeter, compactionsIn } from "./usage";
import {
	CompactionUI,
	InterruptedUI,
	RestedUI,
	StoppedUI,
	TreesContext,
	WorkUI,
} from "./work-row";

/**
 * One conversation: its header, then assistant-ui's thread, fed by `like`,
 * with what the agent is asking above its composer. ⌥⌘⌫ (Ctrl+Alt+Backspace
 * off a Mac) archives it; only Unarchive brings it back. Its artifacts open
 * in their viewers, from the card beside it and the lines in it alike.
 */
export const Thread = memo(function Thread(
	props: Parameters<typeof Conversation>[0],
): JSX.Element {
	const { conversation } = props;
	return (
		<ArtifactViewer
			conversation={conversation.id}
			artifacts={conversation.artifacts}
		>
			<Conversation {...props} />
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
}): JSX.Element {
	const { id, settings, archived, summary } = conversation;
	useEffect(() => {
		if (summary) {
			void feed.whole(id);
		}
	}, [feed, id, summary]);
	const refused = useCallback(
		(title: string, error: unknown) => refuseIn(id, title, error),
		[refuseIn, id],
	);
	const choose = useChooseSetting(id, refused);
	const thread = useThreadMessages(conversation, feed);
	const { queued, openAt, asking } = thread;
	const {
		runtime,
		stopping,
		send,
		retry,
		edit: editUnsent,
	} = useThreadRuntime(conversation, feed, drafts, thread, refused);
	const unsent = useReactive(feed, (feed) => feed.unsent.get(id), ["changed"]);
	const unsentActions = useMemo(
		() => ({ unsent: unsent ?? [], retry, edit: editUnsent }),
		[unsent, retry, editUnsent],
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
	useArrived(id, () => onBack === null && toWaiting(section.current));
	const projects = useProjects();
	const references = useReferences(tasks, actions, projects ?? undefined);
	const root = useContext(TreesContext)?.root ?? null;
	const named = useNamed(
		paths,
		projects,
		task?.worktree ?? (conversation.task === null ? root : null),
	);
	const listed = useMemo(
		() => ({ conversation: id, background: conversation.background }),
		[id, conversation.background],
	);
	// What the conversation's last word reports, to offer archiving it when
	// the task is over.
	const { offer, barred } = useArchiveOffer(
		archived || !filable(conversation) ? null : ended(conversation),
		() => archive.file(onLeft),
	);
	const widgets = useWidgets(section);
	const nameOf = useNameOf();
	return (
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
				"@container flex min-h-0 min-w-0 flex-col",
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
			{archived && <ArchivedBanner phone={onBack !== null} />}
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
			<PhoneSheets conversation={id} on={onBack !== null}>
				<TaskRegistry>
					{(version) => (
						<div
							className="relative min-h-0 flex-1"
							style={{
								["--thread-inset-end" as string]:
									widgets.roomy && widgets.open ? WIDGETS_ROOM : "0px",
							}}
						>
							<AssistantRuntimeProvider runtime={runtime}>
								<Composing.Provider value={runtime.thread.composer}>
									<UnsentContext.Provider value={unsentActions}>
										<QuestionsUI />
										<ReviewUI />
										<ReportUI />
										<TodoUI />
										<QueueUI />
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
										<ArchiveOfferProvider value={offer}>
											<StartNewContext value={startNew}>
												<ReplyContext value={reply}>
													<NamedContext value={named}>
														<ListedBackground value={listed}>
															<ThreadView
																openAt={openAt}
																autoFocus={!asking || typed}
																stopping={stopping}
																mentions={mentions ?? undefined}
																references={references}
																commands={commands ?? undefined}
																placeholder={
																	archived
																		? "Send a message to unarchive and continue"
																		: undefined
																}
																controls={
																	!archived && (
																		<>
																			<ContextMeter
																				usage={conversation.usage}
																				compactions={compactionsIn(
																					conversation.messages,
																				)}
																			/>
																			<SettingControls
																				settings={settings}
																				current={(setting) => setting.current}
																				onChange={choose}
																			/>
																		</>
																	)
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
														</ListedBackground>
													</NamedContext>
												</ReplyContext>
											</StartNewContext>
										</ArchiveOfferProvider>
									</UnsentContext.Provider>
								</Composing.Provider>
							</AssistantRuntimeProvider>
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
								<CurrentTask version={version} />
							</Widgets>
						</div>
					)}
				</TaskRegistry>
			</PhoneSheets>
		</section>
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
				event.at > said && (isEscalation(event) || lineOf(event) !== null),
		);
	return movedOn ? null : report;
}

/**
 * Atop an archived conversation, across the pane's padding to its edges,
 * saying so and how it comes back.
 */
function ArchivedBanner({ phone }: { phone: boolean }): JSX.Element {
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
		</p>
	);
}
