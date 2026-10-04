import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { type JSX, useEffect, useState } from "react";
import { Toaster } from "#dev/components/ui/toast.tsx";
import { Feed } from "./feed";
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

	useEffect(() => {
		document.title = snapshot?.repo ?? "arbor";
	}, [snapshot?.repo]);

	return (
		<Toaster>
			<main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-4 py-6">
				<header className="flex items-center justify-between">
					<div className="flex min-w-0 items-baseline gap-2">
						<h1 className="shrink-0 font-medium text-sm">
							{snapshot?.repo ?? "arbor"}
						</h1>
						{snapshot && (
							<span className="min-w-0 truncate text-muted-foreground text-xs">
								{snapshot.path}
							</span>
						)}
					</div>
					{/* Silent while connected, which is the normal case. Once the server
					    stops answering, the page says so, since what it shows may no
					    longer be true. */}
					{offline && (
						<span role="status" className="shrink-0 text-destructive text-xs">
							Offline: is `arbor dev` still running?
						</span>
					)}
				</header>
				{/* Tasks first: there are only ever a few, and they are what is moving
				    right now. The todos below are what comes after. */}
				{snapshot === null ? null : (
					<>
						<section aria-labelledby="tasks" className="flex flex-col gap-2">
							<h2
								id="tasks"
								className="font-medium text-muted-foreground text-xs"
							>
								Tasks
							</h2>
							<Tasks tasks={snapshot.tasks} />
						</section>
						<section aria-labelledby="todos" className="flex flex-col gap-2">
							<h2
								id="todos"
								className="font-medium text-muted-foreground text-xs"
							>
								Todos
							</h2>
							<Todos snapshot={snapshot} />
						</section>
					</>
				)}
			</main>
		</Toaster>
	);
}
