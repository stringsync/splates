import { useDisposerEffect, useReactive } from "@webappwiz/react";
import {
	GitBranchIcon,
	InboxIcon,
	ListTodoIcon,
	type LucideIcon,
	ScrollTextIcon,
} from "lucide-react";
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

const TABS: { value: string; label: string; Icon: LucideIcon }[] = [
	{ value: "inbox", label: "Inbox", Icon: InboxIcon },
	{ value: "todos", label: "Todos", Icon: ListTodoIcon },
	{ value: "tasks", label: "Tasks", Icon: GitBranchIcon },
	{ value: "log", label: "Log", Icon: ScrollTextIcon },
];

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

	// Replied ones wait on their agent, not on you, so they are not counted.
	const open =
		snapshot?.inbox.questions.filter((question) => question.state === "open")
			.length ?? 0;
	// The tab says what waits on you, so a phone's tab switcher does too.
	useEffect(() => {
		const repo = snapshot?.repo ?? "arbor";
		document.title = open > 0 ? `(${open}) ${repo}` : repo;
	}, [snapshot?.repo, open]);

	return (
		<Toaster>
			<main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 pt-6 pb-28">
				<header className="flex items-center justify-between">
					<h1 className="font-medium text-sm">{snapshot?.repo ?? "arbor"}</h1>
					{/* Silent while connected, which is the normal case. Once the server
					    stops answering, the page says so, since what it shows may no
					    longer be true. */}
					{offline && (
						<span role="status" className="text-destructive text-xs">
							Offline: is `arbor dev` still running?
						</span>
					)}
				</header>
				{snapshot === null ? null : (
					<Tabs defaultValue="inbox" className="gap-6">
						{/* A bar along the bottom, where a thumb already is. The sheets
						    rise over it, so a question has the whole screen. */}
						<TabsList
							variant="line"
							className="fixed inset-x-0 bottom-0 z-40 w-full group-data-horizontal/tabs:h-auto justify-around rounded-none border-t bg-background/95 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur"
						>
							{TABS.map(({ value, label, Icon }) => (
								<TabsTrigger
									key={value}
									value={value}
									className="h-auto flex-1 flex-col gap-0.5 py-1 text-xs after:hidden"
								>
									<span className="relative">
										<Icon className="size-5" />
										{value === "inbox" && open > 0 && (
											<span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-primary px-1 text-[0.625rem] text-primary-foreground tabular-nums leading-4">
												{open}
											</span>
										)}
									</span>
									{label}
								</TabsTrigger>
							))}
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
