import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { type JSX, useEffect, useState } from "react";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#dev/components/ui/tabs.tsx";
import { Toaster } from "#dev/components/ui/toast.tsx";
import { Feed } from "./feed";
import { Inbox } from "./inbox";
import { Log } from "./log";
import { Tasks } from "./tasks";
import { Todos } from "./todos";

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

	const open = snapshot?.inbox.questions.length ?? 0;
	// The tab says what waits on you, so a phone's tab switcher does too.
	useEffect(() => {
		const repo = snapshot?.repo ?? "arbor";
		document.title = open > 0 ? `(${open}) ${repo}` : repo;
	}, [snapshot?.repo, open]);

	return (
		<Toaster>
			<main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 pt-6 pb-16">
				<header className="flex items-center justify-between">
					<h1 className="font-medium text-sm">{snapshot?.repo ?? "arbor"}</h1>
					{/* A dot and nothing else while connected: the page only speaks up
					    when it can no longer be trusted. */}
					<span
						role="status"
						title={
							offline ? "not connected: is `arbor dev` still running?" : "live"
						}
						className={
							offline
								? "text-destructive text-xs"
								: "size-1.5 rounded-full bg-muted-foreground/40"
						}
					>
						{offline ? "offline" : null}
					</span>
				</header>
				{snapshot === null ? null : (
					<Tabs defaultValue="inbox" className="gap-6">
						<TabsList variant="line" className="w-full justify-start gap-4">
							<TabsTrigger value="inbox" className="flex-none">
								Inbox{open > 0 ? <Count>{open}</Count> : null}
							</TabsTrigger>
							<TabsTrigger value="todos" className="flex-none">
								Todos
							</TabsTrigger>
							<TabsTrigger value="tasks" className="flex-none">
								Tasks
							</TabsTrigger>
							<TabsTrigger value="log" className="flex-none">
								Log
							</TabsTrigger>
						</TabsList>
						<TabsContent value="inbox">
							<Inbox snapshot={snapshot} />
						</TabsContent>
						<TabsContent value="todos">
							<Todos snapshot={snapshot} />
						</TabsContent>
						<TabsContent value="tasks">
							<Tasks tasks={snapshot.tasks} />
						</TabsContent>
						<TabsContent value="log">
							<Log entries={snapshot.entries} />
						</TabsContent>
					</Tabs>
				)}
			</main>
		</Toaster>
	);
}

function Count({ children }: { children: number }): JSX.Element {
	return <span className="text-muted-foreground tabular-nums">{children}</span>;
}
