import { useDisposerEffect, useReactive } from "@webappwiz/react";
import {
	GitBranchIcon,
	KanbanIcon,
	type LucideIcon,
	MessagesSquareIcon,
} from "lucide-react";
import { type JSX, useEffect, useState, useSyncExternalStore } from "react";
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
import { Tasks } from "./tasks";
import { Todos } from "./todos";

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
	{ value: "todos", label: "Todos", Icon: KanbanIcon },
	{ value: "tasks", label: "Tasks", Icon: GitBranchIcon },
	{ value: "conversations", label: "Conversations", Icon: MessagesSquareIcon },
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

export function App(): JSX.Element {
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
	const { available } = useReactive(
		talk,
		(talk) => ({ available: talk.available }),
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

	const waiting = useWaiting(talk, snapshot?.tasks ?? NO_TASKS);
	const counted = available && waiting > 0;
	useEffect(() => {
		const name = snapshot?.repo ?? "arbor";
		document.title = counted ? `(${waiting}) ${name}` : name;
	}, [snapshot?.repo, counted, waiting]);

	const wide = useWide();
	// The task whose changes are open beside the page, whatever the page.
	const [reviewing, setReviewing] = useState<string | null>(null);
	const reviewed = snapshot?.tasks.find((task) => task.task === reviewing);
	// On a phone, an open conversation takes the whole screen: no header, and
	// no bar along the bottom, which its own Back replaces.
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
				<TooltipProvider>
					<Tabs
						value={page}
						onValueChange={(value) => go(value as Page)}
						orientation={wide ? "vertical" : "horizontal"}
						// Clear of the sidebar, or of the bar along the bottom.
						className={cn(
							"min-h-dvh gap-0",
							wide ? "pl-56" : !reading && "pb-20",
							wide && reviewed !== undefined && BESIDE_PANE,
						)}
					>
						{!reading && (
							<>
								{/* Heads the sidebar when there is one, and the page on a phone. */}
								<header
									className={cn(
										"flex min-w-0 flex-col gap-0.5",
										wide
											? "fixed top-0 left-0 z-50 w-56 px-6 pt-5"
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
									</div>
									{snapshot && (
										<span className="truncate text-muted-foreground text-xs">
											{snapshot.path}
										</span>
									)}
								</header>
								{/* With room to spare, a sidebar down the left. On a phone, a bar
				    along the bottom, where a thumb already is; a dialog sits over
				    it. */}
								<TabsList
									variant="line"
									className={
										wide
											? "fixed inset-y-0 left-0 z-40 w-56 items-stretch justify-start gap-1 border-r bg-background px-3 pt-20 group-data-vertical/tabs:h-dvh"
											: "fixed inset-x-0 bottom-0 z-40 w-full justify-around rounded-none border-t bg-background/95 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur group-data-horizontal/tabs:h-auto"
									}
								>
									{pages.map(({ value, label, Icon }) => (
										<TabsTrigger
											key={value}
											value={value}
											className={
												wide
													? "h-9 flex-none gap-3 px-3 after:hidden group-data-[variant=line]/tabs-list:data-active:bg-muted"
													: "h-auto flex-1 flex-col gap-0.5 py-1 text-xs after:hidden"
											}
										>
											<Icon className={cn(!wide && "size-5")} />
											<span className={cn(wide && "flex-1 text-left")}>
												{label}
												{!wide && count(value) !== null && ` ${count(value)}`}
											</span>
											{wide && count(value) !== null && (
												<span className="text-muted-foreground tabular-nums">
													{count(value)}
												</span>
											)}
										</TabsTrigger>
									))}
									{/* Under their tab, so one is a click away from any page. */}
									{wide && available && snapshot !== null && (
										<div className="-mx-3 mt-4 min-h-0 flex-1 overflow-y-auto border-t px-3 pt-4 pb-6">
											<ConversationList
												feed={talk}
												tasks={snapshot.tasks}
												open={page === "conversations" ? open : null}
												onOpen={(id) => go("conversations", id)}
											/>
										</div>
									)}
								</TabsList>
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
										<Conversations
											feed={talk}
											tasks={snapshot.tasks}
											trunk={snapshot.trunk}
											open={open}
											onOpen={(id) => go("conversations", id)}
											phone={!wide}
										/>
									</TabsContent>
								)}
							</>
						)}
					</Tabs>
					{reviewed !== undefined && (
						<ChangesPane
							key={reviewed.task}
							task={reviewed.task}
							version={`${reviewed.ahead}:${reviewed.added}:${reviewed.removed}`}
							phone={!wide}
							onClose={() => setReviewing(null)}
						/>
					)}
				</TooltipProvider>
			</ReviewChanges>
		</Toaster>
	);
}
