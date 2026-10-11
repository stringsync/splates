import { useDisposerEffect, useReactive } from "@webappwiz/react";
import {
	GitBranchIcon,
	KanbanIcon,
	type LucideIcon,
	MessagesSquareIcon,
	SettingsIcon,
} from "lucide-react";
import {
	type CSSProperties,
	type JSX,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#dev/components/ui/tabs.tsx";
import { Toaster } from "#dev/components/ui/toast.tsx";
import { TooltipProvider } from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Details } from "../show";
import { BESIDE_PANE, ChangesPane, ReviewChanges } from "./changes";
import { ConversationFeed } from "./conversation-feed";
import {
	ConversationList,
	Conversations,
	conversationIn,
	useWaiting,
} from "./conversations";
import { Feed } from "./feed";
import { ProjectSwitcher } from "./projects";
import { ReleaseHint } from "./release";
import type { Settings } from "./settings";
import { SettingsDialog } from "./settings-dialog";
import { SidebarHandle, SidebarWidth } from "./sidebar";
import { Tasks } from "./tasks";
import {
	focusComposer,
	ShellRunning,
	TerminalPane,
	ToggleTerminal,
} from "./terminal";
import { isToggle } from "./terminal-session";
import { Terminals } from "./terminals";
import { Todos } from "./todos";
import { TreesContext } from "./work-row";

/**
 * The page's pages, the one in the address first: `#tasks`,
 * `#conversations` (or `#conversations/<id>` for one open), or the board.
 */
type Page = "todos" | "tasks" | "conversations";

function pageIn(hash: string): Page {
	if (hash === "#tasks") {
		return "tasks";
	}
	return hash.startsWith("#conversations") ? "conversations" : "todos";
}

const PAGES: { value: Page; label: string; Icon: LucideIcon }[] = [
	{ value: "conversations", label: "Conversations", Icon: MessagesSquareIcon },
	{ value: "todos", label: "Todos", Icon: KanbanIcon },
	{ value: "tasks", label: "Tasks", Icon: GitBranchIcon },
];

/** Wide enough for a sidebar: a laptop, or a tablet held sideways. */
const WIDE = "(min-width: 768px)";

/** Before the first snapshot: one array, so nothing recomputes for a new one. */
const NO_TASKS: Details[] = [];

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

export function App({ settings }: { settings: Settings }): JSX.Element {
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
	const { available, conversations } = useReactive(
		talk,
		(talk) => ({
			available: talk.available,
			conversations: talk.conversations,
		}),
		["changed"],
	);
	// A shell per conversation, kept until the tab closes.
	const [terminals] = useState(() => new Terminals(localStorage));
	useDisposerEffect((disposer) => disposer.use(terminals), [terminals]);
	const { terminal } = useReactive(
		terminals,
		(terminals) => ({ terminal: terminals.open }),
		["changed"],
	);
	// Kept in the address, so a reload or a link lands on the same page.
	const [page, setPage] = useState<Page>(() => pageIn(location.hash));
	const [open, setOpen] = useState(() => conversationIn(location.hash));
	useEffect(() => {
		const follow = () => {
			setPage(pageIn(location.hash));
			setOpen(conversationIn(location.hash));
		};
		window.addEventListener("hashchange", follow);
		return () => window.removeEventListener("hashchange", follow);
	}, []);
	const go = (next: Page, conversation: string | null = open) => {
		setPage(next);
		setOpen(conversation);
		const hash =
			next === "conversations" && conversation !== null
				? `#conversations/${conversation}`
				: `#${next}`;
		history.replaceState(null, "", next === "todos" ? " " : hash);
	};
	const pages = PAGES.filter(
		({ value }) => value !== "conversations" || available,
	);

	const [setting, setSetting] = useState(false);
	// ⌘, or Ctrl+, as in an IDE.
	useEffect(() => {
		const open = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === ",") {
				event.preventDefault();
				setSetting(true);
			}
		};
		document.addEventListener("keydown", open);
		return () => document.removeEventListener("keydown", open);
	}, []);

	const waiting = useWaiting(talk, snapshot?.tasks ?? NO_TASKS);
	const counted = available && waiting > 0;
	useEffect(() => {
		const name = snapshot?.repo ?? "arbor";
		document.title = counted ? `(${waiting}) ${name}` : name;
	}, [snapshot?.repo, counted, waiting]);

	const wide = useWide();
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
	const toggleTerminal = (conversation: string) => {
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
	const paned = reviewed !== undefined || (terminal && shown !== null);
	// On a phone, an open conversation takes the whole screen: no header,
	// which its own Back replaces.
	const reading = !wide && page === "conversations" && open !== null;
	// Conversations counts only the agents waiting on you.
	const count = (page: Page) =>
		page === "conversations"
			? counted
				? waiting
				: null
			: snapshot && (page === "todos" ? snapshot.todos : snapshot.tasks).length;

	return (
		<Toaster>
			<ReviewChanges value={setReviewing}>
				<ToggleTerminal value={shown === null ? null : toggleTerminal}>
					<ShellRunning value={shellRunning}>
						<TooltipProvider>
							<Tabs
								value={page}
								onValueChange={(value) => go(value as Page)}
								// Clear of the sidebar.
								className={cn(
									"min-h-dvh gap-0",
									wide && "pl-(--sidebar-width)",
									wide && paned && BESIDE_PANE,
								)}
								style={{ "--sidebar-width": `${width}px` } as CSSProperties}
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
												<ProjectSwitcher name={snapshot?.repo ?? "arbor"} />
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
												{/* A newer arbor is out: restarting onto it is the person's call. */}
												{snapshot?.release && outdated === null && !offline && (
													<ReleaseHint release={snapshot.release} />
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
												{/* Beside the project they belong to, leaving the sidebar to the
										    conversations. */}
												<TabsList
													variant="line"
													className="ml-auto shrink-0 gap-0.5 p-0 group-data-horizontal/tabs:h-auto"
												>
													{pages.map(({ value, label, Icon }) => (
														<TabsTrigger
															key={value}
															value={value}
															title={
																count(value) === null
																	? label
																	: `${label} (${count(value)})`
															}
															className="size-7 flex-none p-0 text-muted-foreground after:hidden hover:bg-muted group-data-[variant=line]/tabs-list:data-active:bg-accent dark:group-data-[variant=line]/tabs-list:data-active:bg-accent data-active:[&_svg]:text-primary"
														>
															<Icon />
															<span className="sr-only">{label}</span>
														</TabsTrigger>
													))}
												</TabsList>
												{/* At the foot of the sidebar when there is one. */}
												{!wide && (
													<button
														type="button"
														aria-label="Settings"
														title="Settings"
														onClick={() => setSetting(true)}
														className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
													>
														<SettingsIcon className="size-4" />
													</button>
												)}
											</div>
											{snapshot && (
												<span className="truncate text-muted-foreground text-xs">
													{snapshot.path}
												</span>
											)}
										</header>
										{/* With room to spare, a sidebar down the left, all
								    conversations. A phone has the list as its own page. */}
										{wide && (
											<div className="fixed inset-y-0 left-0 z-40 flex w-(--sidebar-width) flex-col border-r bg-sidebar px-3 pt-20">
												{available && snapshot !== null && (
													<div className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3 pb-6">
														<ConversationList
															feed={talk}
															tasks={snapshot.tasks}
															settings={settings}
															open={page === "conversations" ? open : null}
															onOpen={(id) => go("conversations", id)}
														/>
													</div>
												)}
												<button
													type="button"
													aria-label="Settings"
													onClick={() => setSetting(true)}
													className="-mx-3 mt-auto flex h-12 shrink-0 items-center gap-3 border-t px-6 text-muted-foreground text-sm hover:text-foreground"
												>
													<SettingsIcon className="size-4" />
													<span className="flex-1 text-left">Settings</span>
													<Kbd>⌘,</Kbd>
												</button>
											</div>
										)}
										{wide && <SidebarHandle sidebar={sidebar} />}
									</>
								)}
								{snapshot === null ? null : (
									<>
										{/* The board runs as wide as its lanes, the way a Trello board
						    scrolls sideways. */}
										<TabsContent value="todos" className="min-w-0 px-4 py-4">
											<Todos snapshot={snapshot} />
										</TabsContent>
										<TabsContent
											value="tasks"
											className="mx-auto w-full max-w-xl px-4 py-6"
										>
											<Tasks tasks={snapshot.tasks} />
										</TabsContent>
										{available && (
											<TabsContent
												value="conversations"
												className="min-w-0 px-4 py-4"
											>
												<TreesContext value={snapshot}>
													<Conversations
														feed={talk}
														tasks={snapshot.tasks}
														todos={snapshot.todos}
														lanes={snapshot.lanes}
														trunk={snapshot.trunk}
														open={open}
														onOpen={(id) => go("conversations", id)}
														phone={!wide}
													/>
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
							<SettingsDialog
								settings={settings}
								open={setting}
								onOpenChange={setSetting}
							/>
						</TooltipProvider>
					</ShellRunning>
				</ToggleTerminal>
			</ReviewChanges>
		</Toaster>
	);
}
