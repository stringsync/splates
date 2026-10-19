import type { LaneRecord, TaskRecord } from "@stringsync/splates-server/board";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Details } from "@stringsync/splates-server/tasks";
import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import {
	type Duration,
	SystemClock,
	SystemTimer,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import { TooltipProvider } from "#web/components/ui/tooltip.tsx";
import { Opening } from "./add-project";
import { stats } from "./api";
import { AppHeader } from "./app-header";
import { useWide } from "./app-nav";
import { AutoRestart } from "./auto-restart";
import { AutomationsPage } from "./automations";
import { WatchBackground } from "./background";
import { takenTask } from "./board";
import { BudgetPage } from "./budget";
import { ReviewChanges } from "./changes";
import { CheckpointProvider } from "./checkpoint";
import { terminalAddress } from "./conversation-address";
import { ConversationFeed } from "./conversation-feed";
import { Lanes } from "./conversation-names";
import { Conversations } from "./conversations";
import { CredsPage } from "./creds";
import { DesktopApp } from "./desktop-app";
import { Dispatching, Trunk, useDispatching } from "./dispatching";
import { type DraftFiles, IndexedDraftFiles } from "./draft-files";
import { Drafts } from "./drafts";
import { SnapshotExpecting, Talking } from "./expecting";
import { Feed } from "./feed";
import { ShortcutSettings } from "./hooks/use-shortcut";
import { useWaiting } from "./next-waiting";
import { Notifications } from "./notifications";
import { OpenerContext, openerOf } from "./openers";
import { usePageMenu } from "./page-menu";
import {
	type Page,
	PageShortcuts,
	PHONE_PAGES,
	usePageRoute,
} from "./page-route";
import { usePageVisits } from "./page-visits";
import { PhoneApp } from "./phone-app";
import { listProjects, restartIdle } from "./project-api";
import { useProjectName } from "./project-places";
import type { Found } from "./search";
import { SearchDialog } from "./search-dialog";
import type { Settings } from "./settings";
import { SettingsDialog } from "./settings-dialog";
import { SetupPage } from "./setup-page";
import { SetupProvider } from "./setup-state";
import { matches } from "./shortcuts";
import { NestedPanesContext, useSidePanes } from "./side-panes";
import { Splash } from "./splash";
import { StatsPage } from "./stats";
import { StatsReport } from "./stats-report";
import { Tasks } from "./tasks";
import {
	OpenTerminalPage,
	ShellRunning,
	ShowTerminal,
	ToggleTerminal,
} from "./terminal";
import { Terminals } from "./terminals";
import { TodoView } from "./todo-view";
import { Todos } from "./todos";
import { TreesContext } from "./work-row";
import { WorkersPage } from "./workers";

/** Before the first snapshot: one array, so nothing recomputes for a new one. */
const NO_TASKS: Details[] = [];
const NO_TODOS: TaskRecord[] = [];
const NO_CONVERSATIONS: ConversationState[] = [];
const NO_LANES: LaneRecord[] = [];

/** The page's tree, drawn gray and faded: `index.html` has it in color. */
const OFFLINE_ICON =
	"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><filter id='gray'><feColorMatrix type='saturate' values='0'/></filter><text y='26' font-size='28' filter='url(%23gray)' opacity='0.5'>🍽️</text></svg>";

export function App({
	settings,
	checkpointEvery,
	checkpointRestartShown,
	offlineAfter,
	reload = () => location.reload(),
	autoRestart: given,
	timer,
	wall,
	draftFiles,
}: {
	settings: Settings;
	/** How often a checkpoint under way is asked after; a second by default. */
	checkpointEvery?: Duration;
	/** How long a checkpoint's Restart slide shows at least; three seconds by default. */
	checkpointRestartShown?: Duration;
	/** How long the server stays unreachable before the page says so; ten seconds by default. */
	offlineAfter?: Duration;
	/** Reloads the page, once a restart asked to is back. */
	reload?: () => void;
	/** Restarts `splates server` once out of date; one on the system clock by default. */
	autoRestart?: AutoRestart;
	/** What the conversations' threads wait and read the date by; the system's by default. */
	timer?: Timer;
	wall?: WallClock;
	/** Where drafts' files outlive a reload; IndexedDB by default, where there is one. */
	draftFiles?: DraftFiles | null;
}): JSX.Element {
	// One Feed for as long as this component lives. `useReactive` subscribes to
	// the source it saw on its first render, so an instance that got rebuilt
	// would leave the page listening to the one it replaced, showing nothing.
	const [feed] = useState(() => new Feed(offlineAfter));
	useDisposerEffect(
		(disposer) => {
			feed.start();
			disposer.use(feed);
		},
		[feed],
	);
	const { snapshot, offline, outdated, missing } = useReactive(
		feed,
		(feed) => ({
			snapshot: feed.snapshot,
			offline: feed.offline,
			outdated: feed.outdated,
			missing: feed.missing,
		}),
		["changed"],
	);
	// The tab says so too, for whoever has the page in the background.
	useEffect(() => {
		const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
		if (icon === null || !offline) {
			return;
		}
		const online = icon.href;
		icon.href = OFFLINE_ICON;
		return () => {
			icon.href = online;
		};
	}, [offline]);
	// Its own feed, since `splates server` holds conversations only when asked to.
	const [talk] = useState(() => new ConversationFeed(timer, wall));
	useDisposerEffect(
		(disposer) => {
			talk.start();
			disposer.use(talk);
		},
		[talk],
	);
	const { loading, available, agents, conversations } = useReactive(
		talk,
		(talk) => ({
			loading: talk.loading,
			available: talk.available,
			agents: talk.agents,
			conversations: talk.conversations,
		}),
		["changed"],
	);
	// What was typed and not sent, by conversation and todo: one for the page,
	// so a prompt composed on the board reaches the composer it opens.
	const [drafts] = useState(
		() =>
			new Drafts(
				localStorage,
				draftFiles !== undefined
					? draftFiles
					: typeof indexedDB === "undefined"
						? null
						: new IndexedDraftFiles(indexedDB),
			),
	);
	// A shell per conversation, kept until the tab closes.
	const [terminals] = useState(
		() =>
			new Terminals(
				localStorage,
				(event) =>
					matches(event, settings.get("shortcuts.terminal")) ||
					matches(event, settings.get("shortcuts.newTerminal")),
				{ timer },
			),
	);
	const [autoRestart] = useState(
		() =>
			given ??
			new AutoRestart({ list: listProjects, restart: restartIdle }, settings, {
				timer: new SystemTimer(),
				clock: new SystemClock(),
				input: window,
			}),
	);
	useDisposerEffect((disposer) => disposer.use(terminals), [terminals]);
	const { opener } = useReactive(
		settings,
		(settings) => ({ opener: settings.get("editor.opener") }),
		["changed"],
	);
	const { page, open, task, lane, go, openTask, openLane, cred } =
		usePageRoute();
	const tasks = snapshot?.tasks ?? NO_TASKS;
	// The page's, so ⌘K can open a todo on the board.
	const [todoView] = useState(() => new TodoView(localStorage));
	const searched = {
		tasks,
		todos: snapshot?.todos ?? NO_TODOS,
		conversations: available ? conversations : NO_CONVERSATIONS,
		lanes: snapshot?.laneNames ?? NO_LANES,
	};
	// A todo opens on the board, or as the task that took it.
	const openTodo = (id: number) => {
		const task = takenTask(searched.todos, tasks, id);
		if (task === null) {
			go("todos");
			todoView.open(id);
		} else {
			openTask(task);
		}
	};
	const pick = (found: Found) => {
		if (found.kind === "task") {
			openTask(found.task);
		} else if (found.kind === "conversation") {
			go("conversations", found.conversation);
		} else if (found.kind === "todo") {
			openTodo(found.todo);
		}
	};
	const name = useProjectName(snapshot?.repo);
	const dispatching = useDispatching({
		available,
		drafts,
		talk,
		agents,
		conversations,
		tasks,
		open: (address) => go("conversations", address),
	});
	const [report] = useState(() => new StatsReport({ stats }));
	const visits = usePageVisits({
		open,
		tasks,
		conversations,
		go: (to) => go("conversations", to),
	});

	const [setting, setSetting] = useState(false);
	const pageMenu = usePageMenu({
		snapshot,
		outdated,
		offline,
		onSettings: () => setSetting(true),
	});

	const waiting = useWaiting(talk, tasks);
	const counted = available && waiting > 0;
	useEffect(() => {
		document.title = counted ? `(${waiting}) ${name}` : name;
	}, [name, counted, waiting]);

	const wide = useWide();
	const {
		review,
		watch,
		shellRunning,
		toggleTerminal,
		showTerminal,
		nested,
		shown,
		paned,
		pane,
	} = useSidePanes({
		snapshot,
		conversations,
		available,
		page,
		open,
		terminals,
		wide,
	});
	// What each page shows, laid out by the sidebar's tabs or the phone's own.
	const bodies: Record<Page, ReactNode> | null =
		snapshot === null
			? null
			: {
					todos: (
						<Todos
							snapshot={snapshot}
							drafts={drafts}
							view={todoView}
							lane={lane}
						/>
					),
					tasks: (
						<Tasks
							project={snapshot}
							open={task}
							onOpen={openTask}
							onOpenTodo={(id) => {
								go("todos");
								todoView.open(id);
							}}
						/>
					),
					stats: <StatsPage report={report} />,
					creds: (
						<CredsPage
							requests={snapshot.creds}
							project={snapshot.repo}
							cred={cred}
						/>
					),
					budget: <BudgetPage talk={talk} />,
					workers: (
						<WorkersPage
							tasks={new Set(snapshot.tasks.map((each) => each.task))}
							onOpenTask={openTask}
							onOpenKeys={() => go("creds")}
						/>
					),
					automations: (
						<AutomationsPage opens={{ todo: openTodo, task: openTask }} />
					),
					setup: (
						<SetupPage
							settings={settings}
							todos={snapshot.todos}
							feed={available ? talk : null}
							onOpen={(id) => go("conversations", id)}
						/>
					),
					conversations: available && (
						<TreesContext value={snapshot}>
							<Conversations
								feed={talk}
								terminals={terminals}
								drafts={drafts}
								tasks={snapshot.tasks}
								todos={snapshot.todos}
								lanes={snapshot.lanes}
								trunk={snapshot.trunk}
								open={open}
								onOpen={(id, how) => go("conversations", id, how)}
								onTodos={(ids) => {
									go("todos");
									todoView.filter(ids);
								}}
								phone={!wide}
							/>
						</TreesContext>
					),
				};
	const reachable = !offline && outdated === null;
	const opening = <Opening missing={missing} waiting={reachable} name={name} />;
	const header = (
		<AppHeader
			name={name}
			snapshot={snapshot}
			outdated={outdated}
			offline={offline}
			machine={pageMenu.machine}
		/>
	);

	return (
		<SetupProvider creds={snapshot?.creds ?? null}>
			<OpenerContext value={openerOf(opener)}>
				<SnapshotExpecting value={feed}>
					<Talking feed={talk} held={conversations}>
						<Lanes value={searched.lanes}>
							{/* Here rather than in the sidebar's list, which a phone has none of. */}
							{available && snapshot !== null && (
								<Notifications
									feed={talk}
									tasks={snapshot.tasks}
									settings={settings}
									onOpen={(id) => go("conversations", id)}
								/>
							)}
							<Dispatching value={dispatching}>
								<Trunk value={snapshot?.trunk ?? null}>
									<ReviewChanges value={review}>
										<WatchBackground value={watch}>
											<NestedPanesContext value={nested}>
												<ToggleTerminal
													value={shown === null ? null : toggleTerminal}
												>
													<ShellRunning value={shellRunning}>
														<ShowTerminal
															value={
																available
																	? (id: string) => {
																			go("conversations", id);
																			showTerminal(id);
																		}
																	: null
															}
														>
															<OpenTerminalPage
																value={
																	available
																		? (id: string) =>
																				go("conversations", terminalAddress(id))
																		: null
																}
															>
																<ShortcutSettings value={settings}>
																	<PageShortcuts
																		onPage={go}
																		onBack={available ? visits.back : null}
																		onForward={
																			available ? visits.forward : null
																		}
																		onSettings={() => setSetting(true)}
																		onTerminal={
																			shown === null
																				? null
																				: () => toggleTerminal(shown.id)
																		}
																	/>
																	<TooltipProvider>
																		<CheckpointProvider
																			conversations={conversations.filter(
																				(each) => !each.archived,
																			)}
																			every={checkpointEvery}
																			restartShown={checkpointRestartShown}
																			reload={reload}
																			autoRestart={autoRestart}
																			timer={timer}
																		>
																			{wide ? (
																				<DesktopApp
																					page={page}
																					open={open}
																					go={go}
																					openLane={openLane}
																					name={name}
																					bodies={bodies}
																					opening={opening}
																					paned={paned}
																					available={available}
																					snapshot={snapshot}
																					outdated={outdated}
																					offline={offline}
																					talk={talk}
																					drafts={drafts}
																					terminals={terminals}
																					menu={pageMenu}
																				/>
																			) : (
																				<PhoneApp
																					page={page}
																					open={open}
																					go={go}
																					header={header}
																					offline={offline}
																					body={
																						bodies === null ? (
																							opening
																						) : (
																							<div
																								className={PHONE_PAGES[page]}
																							>
																								{bodies[page]}
																							</div>
																						)
																					}
																					available={available}
																					waiting={counted ? waiting : 0}
																					snapshot={snapshot}
																					talk={talk}
																					drafts={drafts}
																					terminals={terminals}
																					pageMenu={pageMenu}
																				/>
																			)}
																			{pane}
																			<SearchDialog
																				searched={searched}
																				pick={pick}
																			/>
																			<SettingsDialog
																				settings={settings}
																				open={setting}
																				onOpenChange={setSetting}
																				onSetup={() => go("setup")}
																			/>
																			{/* Until the project and its conversations are in, or the page has something else to say. */}
																			<Splash
																				shown={
																					missing === null &&
																					reachable &&
																					(snapshot === null || loading)
																				}
																			/>
																		</CheckpointProvider>
																	</TooltipProvider>
																</ShortcutSettings>
															</OpenTerminalPage>
														</ShowTerminal>
													</ShellRunning>
												</ToggleTerminal>
											</NestedPanesContext>
										</WatchBackground>
									</ReviewChanges>
								</Trunk>
							</Dispatching>
						</Lanes>
					</Talking>
				</SnapshotExpecting>
			</OpenerContext>
		</SetupProvider>
	);
}
