import { useDisposerEffect, useReactive } from "@webappwiz/react";
import {
	GitBranchIcon,
	ListTodoIcon,
	type LucideIcon,
	OctagonPauseIcon,
} from "lucide-react";
import { type JSX, useEffect, useState, useSyncExternalStore } from "react";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#dev/components/ui/tabs.tsx";
import { Toaster } from "#dev/components/ui/toast.tsx";
import { cn } from "#dev/lib/utils.ts";
import { Blocked } from "./blocked";
import { Feed } from "./feed";
import { Tasks } from "./tasks";
import { Todos } from "./todos";

const TABS: { value: string; label: string; Icon: LucideIcon }[] = [
	{ value: "blocked", label: "Blocked", Icon: OctagonPauseIcon },
	{ value: "todos", label: "Todos", Icon: ListTodoIcon },
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
	const wide = useWide();
	const { snapshot, offline } = useReactive(
		feed,
		(feed) => ({ snapshot: feed.snapshot, offline: feed.offline }),
		["changed"],
	);

	const open = snapshot?.blocked.length ?? 0;
	// The tab says what waits on you, so a phone's tab switcher does too.
	useEffect(() => {
		const repo = snapshot?.repo ?? "arbor";
		document.title = open > 0 ? `(${open}) ${repo}` : repo;
	}, [snapshot?.repo, open]);

	return (
		<Toaster>
			{/* Clear of the sidebar, or of the bar along the bottom. */}
			<div className={cn(wide && "pl-56")}>
				<main
					className={cn(
						"mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 pt-6",
						!wide && "pb-28",
					)}
				>
					<header className="flex items-center justify-between">
						{/* Heads the sidebar when there is one. */}
						<h1
							className={cn(
								"min-w-0 truncate font-medium text-sm",
								wide && "fixed top-6 left-6 z-50 max-w-44",
							)}
						>
							{snapshot?.repo ?? "arbor"}
						</h1>
						{/* Silent while connected, which is the normal case. Once the server
					    stops answering, the page says so, since what it shows may no
					    longer be true. */}
						{offline && (
							<span role="status" className="shrink-0 text-destructive text-xs">
								Offline: is `arbor dev` still running?
							</span>
						)}
					</header>
					{snapshot === null ? null : (
						<Tabs
							defaultValue="blocked"
							orientation={wide ? "vertical" : "horizontal"}
							className="gap-6"
						>
							{/* On a phone, a bar along the bottom, where a thumb already is;
						    the sheets rise over it, so a question has the whole screen.
						    With room to spare, a sidebar down the left instead. */}
							<TabsList
								variant="line"
								className={
									wide
										? "fixed inset-y-0 left-0 z-40 w-56 items-stretch justify-start gap-1 border-r bg-background px-3 pt-16 group-data-vertical/tabs:h-dvh"
										: "fixed inset-x-0 bottom-0 z-40 w-full group-data-horizontal/tabs:h-auto justify-around rounded-none border-t bg-background/95 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur"
								}
							>
								{TABS.map(({ value, label, Icon }) => (
									<TabsTrigger
										key={value}
										value={value}
										className={
											wide
												? "h-9 flex-none gap-3 px-3 after:hidden data-active:bg-muted"
												: "h-auto flex-1 flex-col gap-0.5 py-1 text-xs after:hidden"
										}
									>
										{wide ? (
											<>
												<Icon />
												{label}
												{value === "blocked" && open > 0 && (
													<span className="ml-auto text-muted-foreground text-xs tabular-nums">
														{open}
													</span>
												)}
											</>
										) : (
											<>
												<span className="relative">
													<Icon className="size-5" />
													{value === "blocked" && open > 0 && (
														<span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-primary px-1 text-[0.625rem] text-primary-foreground tabular-nums leading-4">
															{open}
														</span>
													)}
												</span>
												{label}
											</>
										)}
									</TabsTrigger>
								))}
							</TabsList>
							<TabsContent value="blocked">
								<Blocked snapshot={snapshot} />
							</TabsContent>
							<TabsContent value="todos">
								<Todos snapshot={snapshot} />
							</TabsContent>
							<TabsContent value="tasks">
								<Tasks tasks={snapshot.tasks} />
							</TabsContent>
						</Tabs>
					)}
				</main>
			</div>
		</Toaster>
	);
}
