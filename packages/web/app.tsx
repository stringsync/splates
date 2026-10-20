import type { LaneRecord, TaskRecord } from "@stringsync/splates-server/board";
import type { Details } from "@stringsync/splates-server/tasks";
import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { type JSX, useCallback, useEffect, useMemo, useState } from "react";
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
import { useAppPages } from "./app-pages";
import { AutoRestart } from "./auto-restart";
import { WatchBackground } from "./background";
import { takenTask } from "./board";
import { ReviewChanges } from "./changes";
import { terminalAddress } from "./conversation-address";
import { ConversationCheckpoint } from "./conversation-checkpoint";
import type { ConversationFeed } from "./conversation-feed";
import { Lanes } from "./conversation-names";
import { DesktopApp } from "./desktop-app";
import { DispatchingProvider, Trunk } from "./dispatching";
import { type DraftFiles, IndexedDraftFiles } from "./draft-files";
import { Drafts } from "./drafts";
import { SnapshotExpecting, Talking } from "./expecting";
import type { Feed } from "./feed";
import { ShortcutSettings } from "./hooks/use-shortcut";
import { useWaiting } from "./next-waiting";
import { Notifications } from "./notifications";
import { useOfflineIcon } from "./offline-icon";
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
import { SetupProvider } from "./setup-state";
import { matches } from "./shortcuts";
import { NestedPanesContext, useSidePanes } from "./side-panes";
import { Splash } from "./splash";
import { StatsReport } from "./stats-report";
import {
	OpenTerminalPage,
	ShellRunning,
	ShowTerminal,
	ToggleTerminal,
} from "./terminal";
import { Terminals } from "./terminals";
import { TodoView } from "./todo-view";

/** Before the first snapshot: one array, so nothing recomputes for a new one. */
const NO_TASKS: Details[] = [];
const NO_TODOS: TaskRecord[] = [];
const NO_LANES: LaneRecord[] = [];

/**
 * The pages a seeded snapshot draws, its tasks being the project's own; the
 * rest wait for the project's snapshot, the seed having none of their todos,
 * lanes or creds.
 */
const SEEDED_PAGES: ReadonlySet<Page> = new Set(["conversations", "tasks"]);

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
	feed,
	talk,
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
	/** The project's snapshot, kept by `ProjectApp` past a switch of project. */
	feed: Feed;
	/** The project's conversations, kept as `feed` is. */
	talk: ConversationFeed;
}): JSX.Element {
	useDisposerEffect(
		(disposer) => {
			feed.start();
			disposer.use(feed);
		},
		[feed],
	);
	const { snapshot, seeded, offline, outdated, missing } = useReactive(
		feed,
		(feed) => ({
			snapshot: feed.snapshot,
			seeded: feed.seeded,
			offline: feed.offline,
			outdated: feed.outdated,
			missing: feed.missing,
		}),
		["changed"],
	);
	useOfflineIcon(offline);
	useDisposerEffect(
		(disposer) => {
			talk.start();
			disposer.use(talk);
		},
		[talk],
	);
	const { loading, available } = useReactive(
		talk,
		(talk) => ({
			loading: talk.loading,
			available: talk.available,
		}),
		["changed"],
	);
	// What was typed and not sent, by conversation and todo: one for the page,
	// so a prompt composed on the board reaches the composer it opens.
	const [drafts] = useState(
		() => new Drafts(localStorage, IndexedDraftFiles.unlessGiven(draftFiles)),
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
	const { page, open, task, lane, go, openTask, openLane, cred, rule } =
		usePageRoute();
	const tasks = snapshot?.tasks ?? NO_TASKS;
	// The page's, so ⌘K can open a todo on the board.
	const [todoView] = useState(() => new TodoView(localStorage));
	const searched = {
		tasks,
		todos: snapshot?.todos ?? NO_TODOS,
		lanes: snapshot?.laneNames ?? NO_LANES,
	};
	// A todo opens on the board, or as the task that took it.
	const openTodo = useCallback(
		(id: number) => {
			const task = takenTask(snapshot?.todos ?? NO_TODOS, tasks, id);
			if (task === null) {
				go("todos");
				todoView.open(id);
			} else {
				openTask(task);
			}
		},
		[snapshot?.todos, tasks, go, todoView, openTask],
	);
	// What a run of an automation or a pick opens: its todo or its task.
	const opens = useMemo(
		() => ({ todo: openTodo, task: openTask }),
		[openTodo, openTask],
	);
	const openConversation = useCallback(
		(id: string | null, how?: import("./page-address").Move) =>
			go("conversations", id, how),
		[go],
	);
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

	const [report] = useState(() => new StatsReport({ stats }));
	const visits = usePageVisits({
		open,
		tasks,
		feed: talk,
		go: openConversation,
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
		feed: talk,
		available,
		page,
		open,
		terminals,
		wide,
	});
	const revealTerminal = useCallback(
		(id: string) => {
			openConversation(id);
			showTerminal(id);
		},
		[openConversation, showTerminal],
	);
	const openTerminal = useCallback(
		(id: string) => go("conversations", terminalAddress(id)),
		[go],
	);
	const editorOpener = useMemo(() => openerOf(opener), [opener]);
	const bodies = useAppPages({
		snapshot,
		drafts,
		todoView,
		lane,
		task,
		openTask,
		go,
		report,
		cred,
		talk,
		opens,
		rule,
		available,
		terminals,
		open,
		wide,
		openConversation,
	});
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
			<OpenerContext value={editorOpener}>
				<SnapshotExpecting value={feed}>
					<Talking feed={talk}>
						<Lanes value={searched.lanes}>
							{/* Here rather than in the sidebar's list, which a phone has none of. */}
							{available && snapshot !== null && (
								<Notifications
									feed={talk}
									tasks={snapshot.tasks}
									settings={settings}
									onOpen={openConversation}
								/>
							)}
							<DispatchingProvider
								feed={talk}
								drafts={drafts}
								tasks={tasks}
								open={openConversation}
							>
								<Trunk value={snapshot?.trunk ?? null}>
									<ReviewChanges value={review}>
										<WatchBackground value={watch}>
											<NestedPanesContext value={nested}>
												<ToggleTerminal
													value={shown === null ? null : toggleTerminal}
												>
													<ShellRunning value={shellRunning}>
														<ShowTerminal
															value={available ? revealTerminal : null}
														>
															<OpenTerminalPage
																value={available ? openTerminal : null}
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
																		<ConversationCheckpoint
																			feed={talk}
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
																					openLane={openLane}
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
																				feed={talk}
																				pick={pick}
																			/>
																			<SettingsDialog
																				settings={settings}
																				open={setting}
																				onOpenChange={setSetting}
																			/>
																			{/* Until the project and its conversations are in, or the page has something else to say. */}
																			<Splash
																				shown={
																					missing === null &&
																					reachable &&
																					(snapshot === null ||
																						loading ||
																						(seeded && !SEEDED_PAGES.has(page)))
																				}
																			/>
																		</ConversationCheckpoint>
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
							</DispatchingProvider>
						</Lanes>
					</Talking>
				</SnapshotExpecting>
			</OpenerContext>
		</SetupProvider>
	);
}
