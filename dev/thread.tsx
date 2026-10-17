import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { ArchiveIcon } from "lucide-react";
import {
	type JSX,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { Dialog } from "#dev/components/ui/dialog.tsx";
import { Composing } from "#dev/composing.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Report } from "../asked";
import type { ConversationState } from "../conversations";
import type { Details } from "../show";
import { useWidgets, WIDGETS_ROOM, Widgets } from "./actions";
import { ArtifactViewer } from "./artifact-open";
import { ArtifactsCard } from "./artifacts-card";
import { AskPanel } from "./ask-panel";
import { BackgroundRow } from "./background";
import { touchButton } from "./board";
import { ReplyContext } from "./card-reply";
import { ENDINGS, TONES } from "./card-shell";
import { Hearing, hears } from "./check-in";
import { useReply, useTyped } from "./composer-drafts";
import {
	useCommands,
	useFileMentions,
	useNamed,
	useProjects,
	useSystems,
} from "./composer-triggers";
import { NEW } from "./conversation-address";
import { chooseSetting } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { lastReport, useNameOf } from "./conversation-names";
import { CurrentTask, TaskRegistry } from "./current-task";
import { DemoUI } from "./demo-cards";
import type { Drafts } from "./drafts";
import { bleed, ErrorBanner } from "./error-banner";
import { EventUI } from "./event-lines";
import {
	AgentAsk,
	HandedOut,
	ReadOnlyBanner,
	useHandedOutBy,
	useHandedTo,
} from "./handed-out";
import { HeartbeatBanner } from "./heartbeat-banner";
import { useTouch } from "./hooks/use-touch";
import { IdleBanner } from "./idle-banner";
import { PlanSource, StartedByCard } from "./lane-plan";
import { NamedContext } from "./mentioned";
import { QuestionsUI } from "./message-questions";
import { NeedsYouBar, PhoneSheets } from "./phone-sheets";
import { Queued, useQueueEdits } from "./queued";
import { useReferences } from "./references";
import { Refusal } from "./refusal";
import { ReportUI, StartNewContext, StartUI, TodoUI } from "./report-cards";
import { ReviewUI } from "./review-panel";
import { SettingControls } from "./setting-controls";
import { SystemsCard } from "./systems";
import { toWaiting, useArrived } from "./task-view";
import { Task } from "./tasks";
import { useThreadActions } from "./thread-actions";
import { ThreadHeader, useWhereAction } from "./thread-header";
import { useThreadMessages } from "./thread-messages";
import { useThreadRuntime } from "./thread-runtime";
import { BELOW_BAR } from "./top-bar";
import { UnsentContext } from "./unsent";
import { ContextMeter } from "./usage";
import { InterruptedUI, StoppedUI, TreesContext, WorkUI } from "./work-row";

/**
 * One conversation: its header, then assistant-ui's thread, fed by `like`,
 * with what the agent is asking above its composer. ⌥⌘⌫ (Ctrl+Alt+Backspace
 * off a Mac) archives it; only Unarchive brings it back. Its artifacts open
 * in their viewers, from the card beside it and the lines in it alike.
 */
export function Thread(props: Parameters<typeof Conversation>[0]): JSX.Element {
	const { conversation } = props;
	return (
		<ArtifactViewer
			conversation={conversation.id}
			artifacts={conversation.artifacts}
		>
			<Conversation {...props} />
		</ArtifactViewer>
	);
}

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
	const { id, settings, archived } = conversation;
	const refused = useCallback(
		(title: string, error: unknown) => refuseIn(id, title, error),
		[refuseIn, id],
	);
	const thread = useThreadMessages(conversation, feed);
	const { queued, openAt, asking } = thread;
	const {
		runtime,
		send,
		retry,
		edit: editUnsent,
	} = useThreadRuntime(conversation, feed, drafts, thread, refused);
	const unsent = feed.unsent.get(id);
	const unsentActions = useMemo(
		() => ({ unsent: unsent ?? [], retry, edit: editUnsent }),
		[unsent, retry, editUnsent],
	);
	const section = useRef<HTMLElement>(null);
	// The conversation it answers to, which the person talks to in its place.
	const handedBy = useHandedOutBy(conversation);
	const agentAsks = useHandedTo(conversation).filter(
		(each) => each.ask !== null && !each.archived,
	);
	const reply = useReply(id, drafts, handedBy === null);
	const typed = useTyped(runtime);
	const { adapter: mentions, paths } = useFileMentions(conversation.task);
	const commands = useCommands(conversation.commands);
	const { sendNow, edit, discard } = useQueueEdits(
		id,
		runtime,
		section,
		refused,
	);
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
	const systems = useSystems(conversation.task, tasks);
	const projects = useProjects();
	const references = useReferences(
		tasks,
		actions,
		systems ?? undefined,
		projects ?? undefined,
	);
	const root = useContext(TreesContext)?.root ?? null;
	const named = useNamed(
		paths,
		systems,
		projects,
		task?.worktree ?? (conversation.task === null ? root : null),
	);
	// What the conversation's last word reports, to offer archiving it when
	// the task is over, or the lanes it worked are.
	const report = lastReport(conversation);
	const ended =
		report !== null &&
		report.ending !== "escalated" &&
		report.ending !== "waiting" &&
		report.ending !== "working" &&
		!archived
			? report
			: null;
	const widgets = useWidgets(section);
	const nameOf = useNameOf();
	const touch = useTouch();
	return (
		<section
			ref={section}
			aria-label={nameOf(conversation)}
			// Up in an empty composer takes back the last queued message, as a
			// terminal brings back the last command. Enter with nothing typed
			// sends what is queued now, as in Zed; ⌘⇧↵ (Ctrl+Shift+Enter) with
			// something typed sends that now too, as `useThreadRuntime` steers. On the
			// way down, so the composer is read before it sends and empties. A
			// phone's Return only types a new line.
			onKeyDownCapture={(event) => {
				const box = event.target as HTMLElement;
				if (
					event.key === "Enter" &&
					!touch &&
					!event.shiftKey &&
					box.getAttribute("aria-label") === "Message input" &&
					runtime.thread.composer.getState().text === "" &&
					queued.length > 0
				) {
					event.preventDefault();
					event.stopPropagation();
					void sendNow();
					return;
				}
				if (
					event.key === "ArrowUp" &&
					box.getAttribute("aria-label") === "Message input" &&
					runtime.thread.composer.getState().text === "" &&
					queued.length > 0 &&
					// The last one is still on its way, with nothing to take back.
					feed.unrecorded(id) === 0
				) {
					event.preventDefault();
					void edit(queued.length - 1);
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
				task={task}
				free={free}
				trunk={trunk}
				refused={refused}
				widgets={widgets}
				onTake={(text) => void send(text, []).catch(() => {})}
				onDetails={() => setDetails(true)}
				// With the same agent, in the main tree: a task's tree is its own.
				onNew={() => onOpen(`${NEW}/${conversation.agent}`)}
				onBack={onBack}
			/>
			{archived && <ArchivedBanner phone={onBack !== null} />}
			{handedBy !== null && (
				<ReadOnlyBanner by={handedBy} phone={onBack !== null} />
			)}
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
					handedBy={handedBy}
					phone={onBack !== null}
					onOpen={onOpen}
				/>
			)}
			{conversation.status === "stopped" &&
				conversation.stoppedIdle !== null && (
					<IdleBanner
						handedBy={handedBy}
						phone={onBack !== null}
						onOpen={onOpen}
					/>
				)}
			{conversation.heartbeat !== null && (
				<HeartbeatBanner at={conversation.heartbeat} phone={onBack !== null} />
			)}
			<PlanSource value={{ conversation, tasks, onOpen }}>
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
											<StartUI />
											<TodoUI />
											<DemoUI />
											<WorkUI />
											<EventUI />
											<StoppedUI />
											<InterruptedUI />
											<Hearing value={hears(conversation)}>
												<StartNewContext value={startNew}>
													{/* Its cards read-only: only its orchestrator replies to it. */}
													<ReplyContext
														value={handedBy === null ? reply : null}
													>
														<NamedContext value={named}>
															<ThreadView
																openAt={openAt}
																autoFocus={!asking || typed}
																mentions={mentions ?? undefined}
																references={references}
																commands={commands ?? undefined}
																composer={
																	handedBy === null ? undefined : (
																		<HandedOut
																			conversation={conversation}
																			by={handedBy}
																			onOpen={onOpen}
																		/>
																	)
																}
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
																			/>
																			<SettingControls
																				settings={settings}
																				current={(setting) => setting.current}
																				onChange={(setting, value) =>
																					chooseSetting(
																						id,
																						setting.id,
																						value,
																					).catch((error: unknown) =>
																						refused(
																							`${setting.name} not switched`,
																							error,
																						),
																					)
																				}
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
																		{ended !== null && handedBy === null && (
																			<ArchiveBar
																				report={ended}
																				onArchive={() => archive.file(onLeft)}
																			/>
																		)}
																		{queued.length > 0 && (
																			<Queued
																				conversation={id}
																				messages={queued}
																				pending={feed.unrecorded(id)}
																				edits={
																					handedBy === null
																						? {
																								onEdit: (index) =>
																									void edit(index),
																								onDiscard: (index) =>
																									void discard(index),
																								onSendNow: () => void sendNow(),
																							}
																						: null
																				}
																			/>
																		)}
																		{/* Its agents' asks, which only the person answers. */}
																		{agentAsks.map((agent) => (
																			<AgentAsk
																				key={agent.id}
																				drafts={drafts}
																				conversation={agent}
																			/>
																		))}
																		{/* Answered where it answers to, beside that one's. */}
																		{conversation.ask !== null &&
																			handedBy === null && (
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
											</Hearing>
										</UnsentContext.Provider>
									</Composing.Provider>
								</AssistantRuntimeProvider>
								<Widgets
									roomy={widgets.roomy}
									open={widgets.open}
									onClose={widgets.close}
									actions={
										onBack !== null && where !== null
											? [where, ...actions]
											: actions
									}
									background={
										<BackgroundRow
											conversation={id}
											background={conversation.background}
										/>
									}
								>
									<StartedByCard conversation={conversation} onOpen={onOpen} />
									<SystemsCard systems={task?.systems ?? []} />
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
			</PlanSource>
		</section>
	);
}

/**
 * A bar above the composer while the conversation's last word is the report
 * of a task that is over, offering to put the conversation away: what to do
 * once nothing is left to say. It goes as the conversation carries on.
 */
function ArchiveBar({
	report,
	onArchive,
}: {
	report: Report;
	onArchive: () => void;
}): JSX.Element {
	const { title, Icon, tone } = ENDINGS[report.ending];
	return (
		<section
			aria-label="archive"
			className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-xs"
		>
			<Icon className={cn("size-4 shrink-0", TONES[tone].icon)} />
			<span className="min-w-0 truncate">
				{title}{" "}
				<span className="font-mono text-xs">
					{"lanes" in report ? report.lanes.join(", ") : report.task}
				</span>
			</span>
			<Button
				size="sm"
				variant="outline"
				onClick={onArchive}
				className={cn("ml-auto h-7 gap-1.5 bg-background", touchButton)}
			>
				<ArchiveIcon data-icon="inline-start" />
				Archive
			</Button>
		</section>
	);
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
