import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { Loader2Icon } from "lucide-react";
import {
	type CSSProperties,
	type JSX,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type Duration,
	SystemClock,
	SystemTimer,
	SystemWallClock,
} from "webappwiz/time";
import { Tabs, TabsContent } from "#dev/components/ui/tabs.tsx";
import { TooltipProvider } from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState } from "../conversations";
import type { LaneRecord } from "../lanes";
import type { Details } from "../show";
import type { NamedSystem } from "../systems";
import type { TodoState } from "../todo";
import { stats } from "./api";
import { AppHeader } from "./app-header";
import { AppNav, useWide } from "./app-nav";
import { AutoRestart } from "./auto-restart";
import { AutoRestartDialog } from "./auto-restart-dialog";
import { WatchBackground } from "./background";
import { BESIDE_PANE, ReviewChanges } from "./changes";
import { CheckpointProvider } from "./checkpoint";
import { useSystems } from "./composer-triggers";
import { NEW } from "./conversation-address";
import { ConversationFeed } from "./conversation-feed";
import { useWaiting } from "./conversation-list";
import { Lanes } from "./conversation-names";
import { Conversations } from "./conversations";
import { CredsContext, CredsPage } from "./creds";
import { Dispatch } from "./dispatch";
import { Dispatching, Trunk } from "./dispatching";
import { Drafts } from "./drafts";
import { Feed } from "./feed";
import { Held } from "./handed-out";
import { ShortcutSettings } from "./hooks/use-shortcut";
import { Notifications } from "./notifications";
import { OpenerContext, openerOf } from "./openers";
import { type Page, PageShortcuts, usePageRoute } from "./page-route";
import { listProjects, restartIdle } from "./project-api";
import { placeOf, rememberPlace, shownProject } from "./projects";
import type { Found } from "./search";
import { SearchDialog } from "./search-dialog";
import type { Settings } from "./settings";
import { SettingsDialog } from "./settings-dialog";
import { matches } from "./shortcuts";
import { useSidePanes } from "./side-panes";
import { SidebarWidth } from "./sidebar";
import { StatsPage } from "./stats";
import { StatsReport } from "./stats-report";
import { TASK } from "./task-view";
import { Tasks } from "./tasks";
import { ShellRunning, ToggleTerminal } from "./terminal";
import { Terminals } from "./terminals";
import { TodoView } from "./todo-view";
import { Todos } from "./todos";
import { Visits } from "./visits";
import { TreesContext } from "./work-row";

/** Before the first snapshot: one array, so nothing recomputes for a new one. */
const NO_TASKS: Details[] = [];
const NO_SYSTEMS: NamedSystem[] = [];
const NO_TODOS: TodoState[] = [];
const NO_CONVERSATIONS: ConversationState[] = [];
const NO_LANES: LaneRecord[] = [];

/** The page's tree, drawn gray and faded: `index.html` has it in color. */
const OFFLINE_ICON =
	"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><filter id='gray'><feColorMatrix type='saturate' values='0'/></filter><text y='26' font-size='28' filter='url(%23gray)' opacity='0.5'>🌲</text></svg>";

export function App({
	settings,
	checkpointEvery,
	checkpointRestartShown,
	offlineAfter,
}: {
	settings: Settings;
	/** How often a checkpoint under way is asked after; a second by default. */
	checkpointEvery?: Duration;
	/** How long a checkpoint's Restart slide shows at least; three seconds by default. */
	checkpointRestartShown?: Duration;
	/** How long the server stays unreachable before the page says so; ten seconds by default. */
	offlineAfter?: Duration;
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
	const { snapshot, offline, outdated } = useReactive(
		feed,
		(feed) => ({
			snapshot: feed.snapshot,
			offline: feed.offline,
			outdated: feed.outdated,
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
	// Its own feed, since `arbor dev` holds conversations only when asked to.
	const [talk] = useState(() => new ConversationFeed());
	useDisposerEffect(
		(disposer) => {
			talk.start();
			disposer.use(talk);
		},
		[talk],
	);
	const { available, agents, conversations } = useReactive(
		talk,
		(talk) => ({
			available: talk.available,
			agents: talk.agents,
			conversations: talk.conversations,
		}),
		["changed"],
	);
	// What was typed and not sent, by conversation and todo: one for the page,
	// so a prompt composed on the board reaches the composer it opens.
	const [drafts] = useState(() => new Drafts(localStorage));
	// A shell per conversation, kept until the tab closes.
	const [terminals] = useState(
		() =>
			new Terminals(localStorage, (event) =>
				matches(event, settings.get("shortcuts.terminal")),
			),
	);
	const [autoRestart] = useState(
		() =>
			new AutoRestart({ list: listProjects, restart: restartIdle }, settings, {
				timer: new SystemTimer(),
				clock: new SystemClock(),
				wall: new SystemWallClock(),
				input: window,
				storage: sessionStorage,
				reload: () => location.reload(),
			}),
	);
	useDisposerEffect((disposer) => disposer.use(terminals), [terminals]);
	const { opener } = useReactive(
		settings,
		(settings) => ({ opener: settings.get("editor.opener") }),
		["changed"],
	);
	const { page, open, task, go, openTask } = usePageRoute();
	const tasks = snapshot?.tasks ?? NO_TASKS;
	// The page's, so ⌘K can open a todo on the board.
	const [todoView] = useState(() => new TodoView(localStorage));
	const searched = {
		tasks,
		todos: snapshot?.todos ?? NO_TODOS,
		conversations: available ? conversations : NO_CONVERSATIONS,
		lanes: snapshot?.lanes ?? NO_LANES,
	};
	const pick = (found: Found) => {
		if (found.kind === "task") {
			go("tasks");
			openTask(found.task);
		} else if (found.kind === "conversation") {
			go("conversations", found.conversation);
		} else if (found.kind === "todo") {
			go("todos");
			todoView.open(found.todo);
		}
	};
	// Before the first snapshot, the name this tab last saw the project by,
	// else the one the address names, so a switch heads the page with where it
	// is going rather than "arbor".
	const project = shownProject() ?? "";
	const name = snapshot?.repo ?? placeOf(project).name ?? (project || "arbor");
	const repo = snapshot?.repo;
	useEffect(() => {
		if (repo !== undefined) {
			rememberPlace(project, { name: repo });
		}
	}, [repo, project]);
	const dispatching = useMemo(
		() =>
			available
				? {
						dispatch: new Dispatch(
							drafts,
							talk,
							new URLSearchParams(location.search).get("project"),
							agents,
							conversations,
							tasks,
						),
						open: (address: string) => go("conversations", address),
					}
				: null,
		// `go` is new each render, and only ever sets the page and the address.
		[available, drafts, talk, agents, conversations, tasks, go],
	);
	// Back through the conversations opened and forward, as in a browser's
	// history, past any since archived or merged away.
	const [visits] = useState(() => new Visits());
	const [report] = useState(() => new StatsReport({ stats }));
	// The systems the main tree names, for the Stats page's chips.
	const named = useSystems(null, tasks) ?? NO_SYSTEMS;
	useEffect(() => {
		if (open === null || open === NEW) {
			visits.leave();
		} else {
			visits.visit(open);
		}
	}, [open, visits]);
	const existsRef = useRef<(id: string) => boolean>(() => false);
	existsRef.current = (id: string) =>
		id.startsWith(TASK)
			? tasks.some(({ task }) => `${TASK}${task}` === id)
			: conversations.some((each) => each.id === id && !each.archived);
	const visit = (to: string | null) => {
		if (to !== null) {
			go("conversations", to);
		}
	};

	const [setting, setSetting] = useState(false);

	const waiting = useWaiting(talk, drafts, tasks);
	const counted = available && waiting > 0;
	useEffect(() => {
		document.title = counted ? `(${waiting}) ${name}` : name;
	}, [name, counted, waiting]);

	const wide = useWide();
	// Dragged wider or narrower by its edge, and kept for the next visit.
	const [sidebar] = useState(() => new SidebarWidth(localStorage));
	const { width } = useReactive(
		sidebar,
		(sidebar) => ({ width: sidebar.width }),
		["changed"],
	);
	const { review, watch, shellRunning, toggleTerminal, shown, paned, pane } =
		useSidePanes({
			snapshot,
			conversations,
			available,
			page,
			open,
			terminals,
			wide,
		});
	// On a phone, an open conversation takes the whole screen: no header, and
	// no bar along the bottom, which its own Back replaces.
	const reading = !wide && page === "conversations" && open !== null;

	return (
		<Held value={conversations}>
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
								<ToggleTerminal value={shown === null ? null : toggleTerminal}>
									<ShellRunning value={shellRunning}>
										<ShortcutSettings value={settings}>
											<PageShortcuts
												onPage={go}
												onBack={
													available
														? () => visit(visits.back(existsRef.current))
														: null
												}
												onForward={
													available
														? () => visit(visits.forward(existsRef.current))
														: null
												}
												onSettings={() => setSetting(true)}
												onTerminal={
													shown === null ? null : () => toggleTerminal(shown.id)
												}
											/>
											<TooltipProvider>
												<CheckpointProvider
													conversations={conversations.filter(
														(each) => !each.archived,
													)}
													every={checkpointEvery}
													restartShown={checkpointRestartShown}
												>
													<Tabs
														value={page}
														onValueChange={(value) => go(value as Page)}
														orientation={wide ? "vertical" : "horizontal"}
														// Clear of the sidebar, or of the bar along the bottom.
														className={cn(
															"min-h-dvh gap-0",
															wide
																? "pl-(--sidebar-width)"
																: !reading && "pb-20",
															wide && paned && BESIDE_PANE,
														)}
														style={
															{
																"--sidebar-width": `${width}px`,
															} as CSSProperties
														}
													>
														{!reading && (
															<>
																<AppHeader
																	name={name}
																	snapshot={snapshot}
																	outdated={outdated}
																	offline={offline}
																	conversations={available}
																	wide={wide}
																	onSettings={() => setSetting(true)}
																/>
																<AppNav
																	wide={wide}
																	available={available}
																	waiting={counted ? waiting : 0}
																	snapshot={snapshot}
																	page={page}
																	open={open}
																	onOpen={(id) => go("conversations", id)}
																	talk={talk}
																	terminals={terminals}
																	drafts={drafts}
																	sidebar={sidebar}
																/>
															</>
														)}
														{snapshot === null ? (
															// The server opens a project on its first read, which takes
															// seconds. Offline or outdated, the header already says why
															// nothing came.
															!offline &&
															outdated === null && (
																<div
																	role="status"
																	className="flex flex-1 items-center justify-center gap-2 py-24 text-muted-foreground text-sm"
																>
																	<Loader2Icon className="size-4 animate-spin" />
																	Opening {name}
																</div>
															)
														) : (
															<>
																{/* The board runs as wide as its lanes, the way a Trello board
						    scrolls sideways. */}
																<TabsContent
																	value="todos"
																	className="min-w-0 px-4 py-4"
																>
																	<Todos
																		snapshot={snapshot}
																		drafts={drafts}
																		view={todoView}
																	/>
																</TabsContent>
																<TabsContent
																	value="tasks"
																	className="mx-auto w-full max-w-xl px-4 py-6"
																>
																	<Tasks
																		tasks={snapshot.tasks}
																		open={task}
																		onOpen={openTask}
																	/>
																</TabsContent>
																<TabsContent
																	value="stats"
																	className="mx-auto w-full min-w-0 max-w-3xl px-4 py-6"
																>
																	<StatsPage report={report} systems={named} />
																</TabsContent>
																<TabsContent
																	value="creds"
																	className="mx-auto w-full min-w-0 max-w-3xl px-4 py-6"
																>
																	<CredsPage
																		requests={snapshot.creds}
																		project={snapshot.repo}
																	/>
																</TabsContent>
																{available && (
																	<TabsContent
																		value="conversations"
																		className="min-w-0 px-4 py-4"
																	>
																		<TreesContext value={snapshot}>
																			<CredsContext
																				value={{
																					requests: snapshot.creds,
																					project: snapshot.repo,
																				}}
																			>
																				<OpenerContext value={openerOf(opener)}>
																					<Conversations
																						feed={talk}
																						terminals={terminals}
																						drafts={drafts}
																						tasks={snapshot.tasks}
																						todos={snapshot.todos}
																						lanes={snapshot.lanes}
																						trunk={snapshot.trunk}
																						open={open}
																						onOpen={(id) =>
																							go("conversations", id)
																						}
																						phone={!wide}
																					/>
																				</OpenerContext>
																			</CredsContext>
																		</TreesContext>
																	</TabsContent>
																)}
															</>
														)}
													</Tabs>
													{pane}
													<SearchDialog searched={searched} pick={pick} />
													<SettingsDialog
														settings={settings}
														open={setting}
														onOpenChange={setSetting}
													/>
													<AutoRestartDialog restart={autoRestart} />
												</CheckpointProvider>
											</TooltipProvider>
										</ShortcutSettings>
									</ShellRunning>
								</ToggleTerminal>
							</WatchBackground>
						</ReviewChanges>
					</Trunk>
				</Dispatching>
			</Lanes>
		</Held>
	);
}
