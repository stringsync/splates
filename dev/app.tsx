// scry-ignore-file compact-files: split by a todo in arbor lanes 11 to 19, which removes this line
import { useDisposerEffect, useReactive } from "@webappwiz/react";
import {
	GitBranchIcon,
	KanbanIcon,
	Loader2Icon,
	type LucideIcon,
	MessagesSquareIcon,
} from "lucide-react";
import {
	type CSSProperties,
	type JSX,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type Duration,
	SystemClock,
	SystemTimer,
	SystemWallClock,
} from "webappwiz/time";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#dev/components/ui/tabs.tsx";
import { TooltipProvider } from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState } from "../conversations";
import type { Details } from "../show";
import type { TodoState } from "../todo";
import { listProjects, restartIdle } from "./api";
import { AutoRestart } from "./auto-restart";
import { AutoRestartDialog } from "./auto-restart-dialog";
import { BackgroundPane, WatchBackground } from "./background";
import { BESIDE_PANE, ChangesPane, ReviewChanges } from "./changes";
import { CheckpointProvider, CheckpointRefusal } from "./checkpoint";
import { useAttachKey } from "./components/assistant-ui/elements/attachment.aui";
import { focusComposer } from "./composer-editor";
import { ConversationFeed } from "./conversation-feed";
import {
	ConversationList,
	Conversations,
	conversationIn,
	NEW,
	useWaiting,
} from "./conversations";
import { Dispatch } from "./dispatch";
import { Dispatching, Trunk } from "./dispatching";
import { Drafts } from "./drafts";
import { Feed } from "./feed";
import { useFullscreenKey } from "./fullscreen";
import { useHeld } from "./hooks/use-held";
import { OpenerContext, openerOf } from "./openers";
import { PageMenu } from "./page-menu";
import {
	ProjectSwitcher,
	placeOf,
	rememberPlace,
	shownProject,
} from "./projects";
import type { Found } from "./search";
import { SearchDialog } from "./search-dialog";
import type { Settings } from "./settings";
import { SettingsDialog } from "./settings-dialog";
import { SidebarHandle, SidebarWidth } from "./sidebar";
import { TASK } from "./task-view";
import { Tasks } from "./tasks";
import { ShellRunning, TerminalPane, ToggleTerminal } from "./terminal";
import { isToggle } from "./terminal-session";
import { Terminals } from "./terminals";
import { TodoView } from "./todo-view";
import { Todos } from "./todos";
import { Visits } from "./visits";
import { TreesContext } from "./work-row";

/**
 * The page's pages, the one in the address first: `#tasks` (or
 * `#tasks/<name>` for one open), `#conversations` (or `#conversations/<id>`
 * for one open), or the board.
 */
type Page = "todos" | "tasks" | "conversations";

function pageIn(hash: string): Page {
	if (hash === "#tasks" || hash.startsWith("#tasks/")) {
		return "tasks";
	}
	return hash.startsWith("#conversations") ? "conversations" : "todos";
}

/** The task `#tasks/<name>` has open, or null. */
function taskIn(hash: string): string | null {
	const [, task] = hash.match(/^#tasks\/(.+)$/) ?? [];
	return task ?? null;
}

/** Each page with the key that opens it with ⌥⌘, if any. */
const PAGES: {
	value: Page;
	label: string;
	Icon: LucideIcon;
	key?: string;
}[] = [
	{
		value: "conversations",
		label: "Conversations",
		Icon: MessagesSquareIcon,
		// None: ⌥⌘C opens Checkpoint.
	},
	{ value: "todos", label: "Todos", Icon: KanbanIcon, key: "T" },
	{ value: "tasks", label: "Tasks", Icon: GitBranchIcon },
];

/** Wide enough for a sidebar: a laptop, or a tablet held sideways. */
const WIDE = "(min-width: 768px)";

/** Before the first snapshot: one array, so nothing recomputes for a new one. */
const NO_TASKS: Details[] = [];
const NO_TODOS: TodoState[] = [];
const NO_CONVERSATIONS: ConversationState[] = [];

/** Whether the window is `WIDE` right now, following it as it resizes. */
function useWide(): boolean {
	return useSyncExternalStore(
		(changed) => {
			const query = matchMedia(WIDE);
			query.addEventListener("change", changed);
			return () => query.removeEventListener("change", changed);
		},
		() => matchMedia(WIDE).matches,
	);
}

/** The page's tree, drawn gray and faded: `index.html` has it in color. */
const OFFLINE_ICON =
	"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><filter id='gray'><feColorMatrix type='saturate' values='0'/></filter><text y='26' font-size='28' filter='url(%23gray)' opacity='0.5'>🌲</text></svg>";

export function App({
	settings,
	checkpointEvery,
	checkpointRestartShown,
}: {
	settings: Settings;
	/** How often a checkpoint under way is asked after; a second by default. */
	checkpointEvery?: Duration;
	/** How long a checkpoint's Restart slide shows at least; three seconds by default. */
	checkpointRestartShown?: Duration;
}): JSX.Element {
	// One Feed for as long as this component lives. `useReactive` subscribes to
	// the source it saw on its first render, so an instance that got rebuilt
	// would leave the page listening to the one it replaced, showing nothing.
	const [feed] = useState(() => new Feed());
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
	const [terminals] = useState(() => new Terminals(localStorage));
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
	const { terminal } = useReactive(
		terminals,
		(terminals) => ({ terminal: terminals.open }),
		["changed"],
	);
	// Kept in the address, so a reload or a link lands on the same page.
	const [page, setPage] = useState<Page>(() => pageIn(location.hash));
	const [open, setOpen] = useState(() => conversationIn(location.hash));
	const [task, setTask] = useState(() => taskIn(location.hash));
	useEffect(() => {
		const follow = () => {
			setPage(pageIn(location.hash));
			setOpen(conversationIn(location.hash));
			setTask(taskIn(location.hash));
		};
		window.addEventListener("hashchange", follow);
		return () => window.removeEventListener("hashchange", follow);
	}, []);
	const go = (next: Page, conversation: string | null = open) => {
		setPage(next);
		setOpen(conversation);
		setTask(null);
		const hash =
			next === "conversations" && conversation !== null
				? `#conversations/${conversation}`
				: `#${next}`;
		history.replaceState(null, "", next === "todos" ? " " : hash);
	};
	const openTask = (name: string | null) => {
		setTask(name);
		// A dialog closing as it goes elsewhere, such as to its questions,
		// leaves the address to where it went.
		if (name !== null || taskIn(location.hash) !== null) {
			history.replaceState(
				null,
				"",
				name === null ? "#tasks" : `#tasks/${name}`,
			);
		}
	};
	const tasks = snapshot?.tasks ?? NO_TASKS;
	// The page's, so ⌘K can open a todo on the board.
	const [todoView] = useState(() => new TodoView(localStorage));
	const searched = {
		tasks,
		todos: snapshot?.todos ?? NO_TODOS,
		conversations: available ? conversations : NO_CONVERSATIONS,
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
							new URLSearchParams(location.search).get("project"),
							agents,
							conversations,
							tasks,
						),
						open: (address: string) => go("conversations", address),
					}
				: null,
		// `go` is new each render, and only ever sets the page and the address.
		// biome-ignore lint/correctness/useExhaustiveDependencies: as above
		[available, drafts, agents, conversations, tasks, go],
	);
	const pages = PAGES.filter(
		({ value }) => value !== "conversations" || available,
	);
	// ⌥⌘ and a page's key opens it, by the key's place, since Alt types
	// another letter on a Mac.
	const goRef = useRef(go);
	goRef.current = go;
	useEffect(() => {
		const open = (event: KeyboardEvent) => {
			if (!event.altKey || !(event.metaKey || event.ctrlKey)) {
				return;
			}
			const found = PAGES.find(({ key }) => event.code === `Key${key}`);
			if (
				found !== undefined &&
				(found.value !== "conversations" || available)
			) {
				event.preventDefault();
				goRef.current(found.value);
			}
		};
		document.addEventListener("keydown", open);
		return () => document.removeEventListener("keydown", open);
	}, [available]);
	// ⌥⌘, goes back through the conversations opened and ⌥⌘. forward, as in
	// a browser's history, past any since archived or merged away.
	const [visits] = useState(() => new Visits());
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
	useEffect(() => {
		if (!available) {
			return;
		}
		// By the key's place, since Alt types another letter on a Mac.
		const step = (event: KeyboardEvent) => {
			if (!event.altKey || !(event.metaKey || event.ctrlKey)) {
				return;
			}
			const to =
				event.code === "Comma"
					? visits.back(existsRef.current)
					: event.code === "Period"
						? visits.forward(existsRef.current)
						: undefined;
			if (to === undefined) {
				return;
			}
			event.preventDefault();
			if (to !== null) {
				goRef.current("conversations", to);
			}
		};
		document.addEventListener("keydown", step);
		return () => document.removeEventListener("keydown", step);
	}, [available, visits]);
	const held = useHeld();

	const [setting, setSetting] = useState(false);
	// ⌘, or Ctrl+, as in an IDE, leaving ⌥⌘, to go back.
	useEffect(() => {
		const open = (event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				event.key === ","
			) {
				event.preventDefault();
				setSetting(true);
			}
		};
		document.addEventListener("keydown", open);
		return () => document.removeEventListener("keydown", open);
	}, []);

	useFullscreenKey();
	useAttachKey();

	const waiting = useWaiting(talk, drafts, tasks);
	const counted = available && waiting > 0;
	useEffect(() => {
		document.title = counted ? `(${waiting}) ${name}` : name;
	}, [name, counted, waiting]);

	const wide = useWide();
	// Whether Restart says a restart would update arbor, with a dot.
	const hinted =
		(snapshot?.release != null || snapshot?.behind != null) &&
		outdated === null &&
		!offline;
	// Dragged wider or narrower by its edge, and kept for the next visit.
	const [sidebar] = useState(() => new SidebarWidth(localStorage));
	const { width } = useReactive(
		sidebar,
		(sidebar) => ({ width: sidebar.width }),
		["changed"],
	);
	// The task whose changes are open beside the page, whatever the page.
	const [reviewing, setReviewing] = useState<string | null>(null);
	const reviewed = snapshot?.tasks.find((task) => task.task === reviewing);
	// The background command whose output is open beside the page, by its
	// conversation, in place of that conversation's terminal.
	const [watching, setWatching] = useState<{
		conversation: string;
		background: string;
	} | null>(null);
	// The conversation up, unless archived, whose terminal the pane shows when the changes
	// do not have it.
	const shown =
		available && page === "conversations"
			? (conversations.find((each) => each.id === open && !each.archived) ??
				null)
			: null;
	// An archived conversation's agent is stopped, and its shell goes with it.
	useEffect(() => {
		for (const each of conversations) {
			if (each.archived) {
				terminals.close(each.id);
			}
		}
	}, [conversations, terminals]);
	const shellRunning = useCallback(
		(conversation: string) => terminals.running(conversation),
		[terminals],
	);
	const watched =
		shown !== null && watching?.conversation === shown.id
			? (shown.background.find((each) => each.id === watching.background) ??
				null)
			: null;
	const watch = useCallback(
		(conversation: string, background: string) => {
			setReviewing(null);
			terminals.hide();
			setWatching({ conversation, background });
		},
		[terminals],
	);
	const closeWatching = useCallback(() => setWatching(null), []);
	const review = useCallback((task: string) => {
		setWatching(null);
		setReviewing(task);
	}, []);
	const toggleTerminal = (conversation: string) => {
		if (watched !== null) {
			setWatching(null);
			terminals.show(conversation);
			return;
		}
		if (reviewing !== null) {
			setReviewing(null);
			terminals.show(conversation);
			return;
		}
		terminals.toggle(conversation);
		if (!terminals.open) {
			focusComposer();
		}
	};
	// The latest, for the listener below, which outlives a render.
	const toggleRef = useRef(toggleTerminal);
	toggleRef.current = toggleTerminal;
	// From anywhere on the page, the terminal included, which leaves the chord
	// to bubble up here.
	const toggled = shown === null ? null : shown.id;
	useEffect(() => {
		if (toggled === null) {
			return;
		}
		const listen = (event: KeyboardEvent) => {
			if (isToggle(event)) {
				event.preventDefault();
				toggleRef.current(toggled);
			}
		};
		window.addEventListener("keydown", listen);
		return () => window.removeEventListener("keydown", listen);
	}, [toggled]);
	const paned =
		reviewed !== undefined || watched !== null || (terminal && shown !== null);
	// On a phone, an open conversation takes the whole screen: no header, and
	// no bar along the bottom, which its own Back replaces.
	const reading = !wide && page === "conversations" && open !== null;
	// The others count what they list; Conversations counts only the agents
	// waiting on you, and only on a phone, since on a wide screen the
	// sidebar's own list says so. None shows for nothing.
	const count = (page: Page) => {
		const counting =
			page === "conversations"
				? counted && !wide
					? waiting
					: 0
				: snapshot === null
					? 0
					: (page === "todos" ? snapshot.todos : snapshot.tasks).length;
		return counting === 0 ? null : counting;
	};

	return (
		<Dispatching value={dispatching}>
			<Trunk value={snapshot?.trunk ?? null}>
				<ReviewChanges value={review}>
					<WatchBackground value={watch}>
						<ToggleTerminal value={shown === null ? null : toggleTerminal}>
							<ShellRunning value={shellRunning}>
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
												wide ? "pl-(--sidebar-width)" : !reading && "pb-20",
												wide && paned && BESIDE_PANE,
											)}
											style={
												{ "--sidebar-width": `${width}px` } as CSSProperties
											}
										>
											{!reading && (
												<>
													{/* Heads the sidebar when there is one, and the page on a phone. */}
													<header
														className={cn(
															"flex min-w-0 flex-col gap-0.5",
															wide
																? "fixed top-0 left-0 z-50 w-(--sidebar-width) px-6 pt-5"
																: "border-b px-4 py-2.5",
														)}
													>
														<div className="flex min-w-0 items-center gap-2">
															<ProjectSwitcher name={name} />
															{/* Silent while connected, which is the normal case. Once the
									    server stops answering, the page says so, since what it
									    shows may no longer be true. */}
															{/* Up but refusing: a newer arbor moved the records on. */}
															{outdated !== null && !offline && (
																<span
																	role="status"
																	title={outdated}
																	className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-[11px] text-amber-600 leading-none dark:text-amber-400"
																>
																	<span className="size-1.5 rounded-full bg-amber-500" />
																	Outdated
																</span>
															)}
															{/* Up, but serving the page built before, since building this
									    one failed, as when a merge added a package. */}
															{snapshot?.unbuilt === true &&
																outdated === null &&
																!offline && (
																	<span
																		role="status"
																		title="Building this page failed as arbor dev started, so it may be out of date: the terminal running arbor dev says why"
																		className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-[11px] text-amber-600 leading-none dark:text-amber-400"
																	>
																		<span className="size-1.5 rounded-full bg-amber-500" />
																		Build failed
																	</span>
																)}
															{offline && (
																<span
																	role="status"
																	title="arbor dev stopped answering: is it still running?"
																	className="flex shrink-0 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-medium text-[11px] text-destructive leading-none"
																>
																	<span className="size-1.5 rounded-full bg-destructive" />
																	Offline
																</span>
															)}
															<PageMenu
																release={
																	hinted ? (snapshot?.release ?? null) : null
																}
																behind={
																	hinted ? (snapshot?.behind ?? null) : null
																}
																conversations={available}
																onSettings={() => setSetting(true)}
															/>
														</div>
														{snapshot && (
															<span className="truncate text-muted-foreground text-xs">
																{snapshot.path}
															</span>
														)}
														{/* Out of the menu that asked, which has closed. */}
														<CheckpointRefusal className="pt-1" />
													</header>
													{/* With room to spare, a sidebar down the left. On a phone, a bar
								    along the bottom, where a thumb already is; a dialog sits over
								    it. */}
													<TabsList
														variant="line"
														className={
															wide
																? // Below the header.
																	"fixed inset-y-0 left-0 z-40 w-(--sidebar-width) items-stretch justify-start gap-1 border-r bg-sidebar px-3 pt-20 group-data-vertical/tabs:h-dvh"
																: "fixed inset-x-0 bottom-0 z-40 w-full justify-around rounded-none border-t bg-background/95 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur group-data-horizontal/tabs:h-auto"
														}
													>
														{pages.map(({ value, label, Icon, key }) => (
															<TabsTrigger
																key={value}
																value={value}
																className={
																	wide
																		? "h-9 flex-none gap-3 px-3 after:hidden group-data-[variant=line]/tabs-list:data-active:bg-accent dark:group-data-[variant=line]/tabs-list:data-active:bg-accent data-active:[&_svg]:text-primary"
																		: "h-auto flex-1 flex-col gap-0.5 py-1 text-xs after:hidden data-active:[&_svg]:text-primary"
																}
															>
																<Icon className={cn(!wide && "size-5")} />
																<span
																	className={cn(wide && "flex-1 text-left")}
																>
																	{label}
																	{!wide &&
																		count(value) !== null &&
																		` ${count(value)}`}
																</span>
																{wide && held && key !== undefined ? (
																	<Kbd aria-hidden>{key}</Kbd>
																) : (
																	wide &&
																	count(value) !== null && (
																		<span className="text-muted-foreground tabular-nums">
																			{count(value)}
																		</span>
																	)
																)}
															</TabsTrigger>
														))}
														{/* Under their tab, so one is a click away from any page. */}
														{wide && available && snapshot !== null && (
															<div className="-mx-3 mt-4 min-h-0 flex-1 overflow-y-auto border-t px-3 pt-4 pb-6">
																<ConversationList
																	feed={talk}
																	terminals={terminals}
																	drafts={drafts}
																	tasks={snapshot.tasks}
																	settings={settings}
																	open={page === "conversations" ? open : null}
																	onOpen={(id) => go("conversations", id)}
																/>
															</div>
														)}
													</TabsList>
													{wide && <SidebarHandle sidebar={sidebar} />}
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
													{available && (
														<TabsContent
															value="conversations"
															className="min-w-0 px-4 py-4"
														>
															<TreesContext value={snapshot}>
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
																		onOpen={(id) => go("conversations", id)}
																		phone={!wide}
																	/>
																</OpenerContext>
															</TreesContext>
														</TabsContent>
													)}
												</>
											)}
										</Tabs>
										{reviewed !== undefined ? (
											<ChangesPane
												key={reviewed.task}
												task={reviewed.task}
												version={`${reviewed.ahead}:${reviewed.added}:${reviewed.removed}`}
												phone={!wide}
												onClose={() => setReviewing(null)}
											/>
										) : watched !== null && shown !== null ? (
											<BackgroundPane
												key={`${shown.id}:${watched.id}`}
												conversation={shown.id}
												background={watched}
												phone={!wide}
												onClose={closeWatching}
											/>
										) : (
											terminal &&
											shown !== null && (
												// One per conversation: its projections are of that one's shell.
												<TerminalPane
													key={shown.id}
													terminals={terminals}
													conversation={shown}
													phone={!wide}
												/>
											)
										)}
										<SearchDialog searched={searched} pick={pick} />
										<SettingsDialog
											settings={settings}
											open={setting}
											onOpenChange={setSetting}
										/>
										<AutoRestartDialog restart={autoRestart} />
									</CheckpointProvider>
								</TooltipProvider>
							</ShellRunning>
						</ToggleTerminal>
					</WatchBackground>
				</ReviewChanges>
			</Trunk>
		</Dispatching>
	);
}
