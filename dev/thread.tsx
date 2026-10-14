import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { ArchiveIcon } from "lucide-react";
import { type JSX, useCallback, useContext, useRef, useState } from "react";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { Dialog } from "#dev/components/ui/dialog.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { Composing } from "#dev/composing.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Report } from "../asked";
import type { ConversationState } from "../conversations";
import type { Details } from "../show";
import { useWidgets, WIDGETS_ROOM, Widgets, WidgetsButton } from "./actions";
import { chooseSetting } from "./api";
import { AskPanel } from "./ask-panel";
import { Back } from "./back";
import { BackgroundRow } from "./background";
import { ReplyContext } from "./card-reply";
import { ENDINGS, TONES } from "./card-shell";
import { useReply, useTyped } from "./composer-drafts";
import {
	useCommands,
	useFileMentions,
	useNamed,
	useSystems,
} from "./composer-triggers";
import type { ConversationFeed } from "./conversation-feed";
import { Rename } from "./conversation-item";
import { lastReport, nameOf, unnamed } from "./conversation-names";
import { CurrentTask, TaskRegistry } from "./current-task";
import { DemoUI } from "./demo-cards";
import type { Drafts } from "./drafts";
import { useShortcutLabel } from "./hooks/use-shortcut";
import { NamedContext } from "./mentioned";
import { QuestionsUI } from "./question-cards";
import { Queued, useQueueEdits } from "./queued";
import { useReferences } from "./references";
import { Refusal, type Refuse } from "./refusal";
import { ReportUI, StartNewContext, StartUI, TodoUI } from "./report-cards";
import { ReviewUI } from "./review-panel";
import { SettingControl } from "./setting-controls";
import { SystemsCard } from "./systems";
import { TakeUp } from "./take-up";
import { TaskLine, toWaiting, useArrived } from "./task-view";
import { Task } from "./tasks";
import { useThreadActions } from "./thread-actions";
import { useThreadMessages } from "./thread-messages";
import { useThreadRuntime } from "./thread-runtime";
import { ContextMeter } from "./usage";
import { StoppedUI, TreesContext, WorkUI } from "./work-row";

/**
 * One conversation: its header, then assistant-ui's thread, fed by `like`,
 * with what the agent is asking above its composer. ⌥⌘⌫ (Ctrl+Alt+Backspace
 * off a Mac) archives it; only Unarchive brings it back.
 */
export function Thread({
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
	 * Once it is archived, to go on to the next agent waiting on you, or a new
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
	const { runtime, send } = useThreadRuntime(
		conversation,
		feed,
		drafts,
		thread,
		refused,
	);
	const section = useRef<HTMLElement>(null);
	const reply = useReply(id, drafts);
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
	// The newest card it waits on you through.
	useArrived(id, () => toWaiting(section.current));
	const systems = useSystems(conversation.task, tasks);
	const references = useReferences(tasks, actions, systems ?? undefined);
	const root = useContext(TreesContext)?.root ?? null;
	const named = useNamed(
		paths,
		systems,
		task?.worktree ?? (conversation.task === null ? root : null),
	);
	// What the conversation's last word reports, to offer archiving it when
	// the task is over.
	const report = lastReport(conversation);
	const ended =
		report !== null && report.ending !== "escalated" && !archived
			? report
			: null;
	const widgets = useWidgets(section);
	return (
		<section
			ref={section}
			aria-label={nameOf(conversation)}
			// Up in an empty composer takes back the last queued message, as a
			// terminal brings back the last command. Enter with nothing typed
			// sends what is queued now, as in Zed; ⌘⇧↵ (Ctrl+Shift+Enter) with
			// something typed sends that now too, as `useThreadRuntime` steers. On the
			// way down, so the composer is read before it sends and empties.
			onKeyDownCapture={(event) => {
				const box = event.target as HTMLElement;
				if (
					event.key === "Enter" &&
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
			className="@container flex h-[calc(100dvh-2rem)] min-h-0 min-w-0 flex-col gap-3"
		>
			{archived && <ArchivedBanner />}
			<ThreadHeader
				conversation={conversation}
				task={task}
				free={free}
				trunk={trunk}
				refused={refused}
				widgets={widgets}
				onTake={(text) => void send(text, []).catch(() => {})}
				onDetails={() => setDetails(true)}
				onBack={onBack}
			/>
			{archive.confirm}
			{task !== null && (
				<Dialog open={details} onOpenChange={setDetails}>
					{details && <Task task={task} />}
				</Dialog>
			)}
			{conversation.error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{conversation.error}
				</p>
			)}
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
								<QuestionsUI />
								<ReviewUI />
								<ReportUI />
								<StartUI />
								<TodoUI />
								<DemoUI />
								<WorkUI />
								<StoppedUI />
								<StartNewContext value={startNew}>
									<ReplyContext value={reply}>
										<NamedContext value={named}>
											<ThreadView
												openAt={openAt}
												autoFocus={!asking || typed}
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
															<ContextMeter usage={conversation.usage} />
															{settings.map((setting) => (
																<SettingControl
																	key={setting.id}
																	setting={setting}
																	value={setting.current}
																	onChange={(value) =>
																		chooseSetting(id, setting.id, value).catch(
																			(error: unknown) =>
																				refused(
																					`${setting.name} not switched`,
																					error,
																				),
																		)
																	}
																/>
															))}
														</>
													)
												}
												above={
													<>
														<Refusal refusal={refusal} className="px-2" />
														{ended !== null && (
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
																onEdit={(index) => void edit(index)}
																onDiscard={(index) => void discard(index)}
																onSendNow={() => void sendNow()}
															/>
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
							</Composing.Provider>
						</AssistantRuntimeProvider>
						<Widgets
							roomy={widgets.roomy}
							open={widgets.open}
							onClose={widgets.close}
							actions={actions}
							background={
								<BackgroundRow
									conversation={id}
									background={conversation.background}
								/>
							}
						>
							<SystemsCard systems={task?.systems ?? []} />
							<CurrentTask version={version} />
						</Widgets>
					</div>
				)}
			</TaskRegistry>
		</section>
	);
}

/**
 * A conversation's header: its name, which a double-click renames, the task
 * it runs in or one it can take up, and the button that shows its widgets.
 */
function ThreadHeader({
	conversation,
	task,
	free,
	trunk,
	refused,
	widgets,
	onTake,
	onDetails,
	onBack,
}: {
	conversation: ConversationState;
	/** The task it runs in; null in the main tree, or once the task is gone. */
	task: Details | null;
	/** The tasks it can take up from the main tree. */
	free: Details[];
	/** The main tree's branch. */
	trunk: string;
	refused: Refuse;
	widgets: { open: boolean; toggle: () => void };
	/** Takes up a task, sending what says so. */
	onTake: (text: string) => void;
	/** Shows its task's details. */
	onDetails: () => void;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const { archived } = conversation;
	const [renaming, setRenaming] = useState(false);
	const branch = task?.branch ?? (conversation.task === null ? trunk : null);
	return (
		<header className="flex min-h-9 items-center gap-2">
			{onBack !== null && <Back onBack={onBack} />}
			<div className="flex min-w-0 flex-1 flex-col">
				{renaming ? (
					<Rename
						conversation={conversation}
						refuse={refused}
						onDone={() => setRenaming(false)}
					/>
				) : (
					// A shortcut: the menu in the sidebar renames too. Capped, so a
					// long name, such as a question it was named after, ends in an
					// ellipsis rather than running across the pane.
					<div className="flex min-w-0 items-center gap-2">
						<h2
							onDoubleClick={() => setRenaming(true)}
							title={`${nameOf(conversation)}\nDouble-click to rename`}
							className={cn(
								"max-w-md truncate font-medium text-sm",
								unnamed(conversation) && "text-muted-foreground italic",
							)}
						>
							{nameOf(conversation)}
						</h2>
					</div>
				)}
				{conversation.task === null && !archived ? (
					<TakeUp trunk={trunk} tasks={free} onTake={onTake} />
				) : (
					<TaskLine branch={branch} task={task} onDetails={onDetails} />
				)}
			</div>
			<WidgetsButton
				open={widgets.open}
				onToggle={widgets.toggle}
				busy={conversation.background.some((each) => each.state === "running")}
			/>
		</header>
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
	const shortcut = useShortcutLabel("shortcuts.archive");
	return (
		<section
			aria-label="archive"
			className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-xs"
		>
			<Icon className={cn("size-4 shrink-0", TONES[tone].icon)} />
			<span className="min-w-0 truncate">
				{title} <span className="font-mono text-xs">{report.task}</span>
			</span>
			{shortcut !== null && <Kbd className="ml-auto">{shortcut}</Kbd>}
			<Button
				size="sm"
				variant="outline"
				onClick={onArchive}
				className={cn(
					"h-7 gap-1.5 bg-background",
					shortcut === null && "ml-auto",
				)}
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
function ArchivedBanner(): JSX.Element {
	return (
		<p
			role="status"
			className="-mx-4 -mt-4 flex shrink-0 items-center justify-center gap-2 border-b bg-muted px-4 py-2 text-muted-foreground text-sm"
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
