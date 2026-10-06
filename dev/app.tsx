import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { GitBranchIcon, KanbanIcon, type LucideIcon } from "lucide-react";
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
import { Feed } from "./feed";
import { Tasks } from "./tasks";
import { Todos } from "./todos";

/** The page's two pages, the one in the address first: `#tasks` or the board. */
type Page = "todos" | "tasks";

function pageIn(hash: string): Page {
	return hash === "#tasks" ? "tasks" : "todos";
}

const PAGES: { value: Page; label: string; Icon: LucideIcon }[] = [
	{ value: "todos", label: "Todos", Icon: KanbanIcon },
	{ value: "tasks", label: "Tasks", Icon: GitBranchIcon },
];

/** Wide enough for a sidebar: a laptop, or a tablet held sideways. */
const WIDE = "(min-width: 768px)";

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
	const { snapshot, offline } = useReactive(
		feed,
		(feed) => ({ snapshot: feed.snapshot, offline: feed.offline }),
		["changed"],
	);
	// Kept in the address, so a reload or a link lands on the same page.
	const [page, setPage] = useState<Page>(() => pageIn(location.hash));
	useEffect(() => {
		const follow = () => setPage(pageIn(location.hash));
		window.addEventListener("hashchange", follow);
		return () => window.removeEventListener("hashchange", follow);
	}, []);
	const go = (next: Page) => {
		setPage(next);
		history.replaceState(null, "", next === "todos" ? " " : `#${next}`);
	};

	useEffect(() => {
		document.title = snapshot?.repo ?? "arbor";
	}, [snapshot?.repo]);

	const wide = useWide();
	const count = (page: Page) =>
		snapshot && (page === "todos" ? snapshot.todos : snapshot.tasks).length;

	return (
		<Toaster>
			<TooltipProvider>
				<Tabs
					value={page}
					onValueChange={(value) => go(value as Page)}
					orientation={wide ? "vertical" : "horizontal"}
					// Clear of the sidebar, or of the bar along the bottom.
					className={cn("min-h-dvh gap-0", wide ? "pl-56" : "pb-20")}
				>
					{/* Heads the sidebar when there is one, and the page on a phone. */}
					<header
						className={cn(
							"flex min-w-0 flex-col gap-0.5",
							wide
								? "fixed top-0 left-0 z-50 w-56 px-6 pt-5"
								: "border-b px-4 py-2.5",
						)}
					>
						<h1 className="truncate font-medium text-sm">
							{snapshot?.repo ?? "arbor"}
						</h1>
						{snapshot && (
							<span className="truncate text-muted-foreground text-xs">
								{snapshot.path}
							</span>
						)}
						{/* Silent while connected, which is the normal case. Once the server
					    stops answering, the page says so, since what it shows may no
					    longer be true. */}
						{offline && (
							<span role="status" className="text-destructive text-xs">
								Offline: is `arbor dev` still running?
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
						{PAGES.map(({ value, label, Icon }) => (
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
					</TabsList>
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
						</>
					)}
				</Tabs>
			</TooltipProvider>
		</Toaster>
	);
}
