import type { Snapshot } from "@stringsync/splates-server/tasks";
import { type ReactNode, useMemo } from "react";
import type { ConversationFeed } from "./conversation-feed";
import { Conversations } from "./conversations";
import { CredsPage } from "./creds";
import type { Drafts } from "./drafts";
import {
	AutomationsPage,
	AutoPickPage,
	BillingPage,
	EvalsPage,
	SetupPage,
	ShipsPage,
	StatsPage,
	Todos,
} from "./lazy-pages";
import type { Page, PageRoute } from "./page-route";
import type { StatsReport } from "./stats-report";
import { Tasks } from "./tasks";
import type { Terminals } from "./terminals";
import type { TodoView } from "./todo-view";
import { TreesContext } from "./work-row";

/** The bodies of the app's pages, for `App` to show the one open. */
export function useAppPages({
	snapshot,
	drafts,
	todoView,
	lane,
	openLane,
	task,
	openTask,
	go,
	report,
	cred,
	talk,
	opens,
	rule,
	evals,
	openEval,
	setup,
	openSetup,
	available,
	terminals,
	open,
	wide,
	openConversation,
}: Pick<
	PageRoute,
	| "lane"
	| "openLane"
	| "task"
	| "openTask"
	| "go"
	| "cred"
	| "rule"
	| "open"
	| "evals"
	| "openEval"
	| "setup"
	| "openSetup"
> & {
	snapshot: Snapshot | null;
	drafts: Drafts;
	todoView: TodoView;
	report: StatsReport;
	talk: ConversationFeed;
	opens: { todo: (id: number) => void; task: (name: string | null) => void };
	available: boolean;
	terminals: Terminals;
	wide: boolean;
	openConversation: (
		id: string | null,
		how?: import("./page-address").Move,
	) => void;
}): Record<Page, ReactNode> | null {
	return useMemo<Record<Page, ReactNode> | null>(
		() =>
			snapshot === null
				? null
				: {
						todos: (
							<Todos
								snapshot={snapshot}
								drafts={drafts}
								view={todoView}
								lane={lane}
								onLane={openLane}
							/>
						),
						tasks: (
							<Tasks
								project={snapshot}
								open={task}
								onOpen={openTask}
								onOpenTodo={(id) => {
									go("todos");
									todoView.open(id);
								}}
							/>
						),
						stats: <StatsPage report={report} />,
						ships: <ShipsPage />,
						evals: <EvalsPage open={evals} onOpen={openEval} />,
						creds: (
							<CredsPage
								requests={snapshot.creds}
								project={snapshot.repo}
								cred={cred}
							/>
						),
						billing: <BillingPage talk={talk} />,
						automations: (
							<AutomationsPage
								opens={opens}
								onAutoPick={() => go("auto-pick")}
							/>
						),
						"auto-pick": (
							<AutoPickPage
								mark={rule}
								tasks={snapshot.tasks}
								todos={snapshot.todos}
								opens={opens}
								onBack={() => go("automations")}
							/>
						),
						setup: (
							<SetupPage
								todos={snapshot.todos}
								feed={available ? talk : null}
								onOpen={openConversation}
								open={setup}
								onSetup={openSetup}
							/>
						),
						conversations: available && (
							<TreesContext value={snapshot}>
								<Conversations
									feed={talk}
									terminals={terminals}
									drafts={drafts}
									tasks={snapshot.tasks}
									todos={snapshot.todos}
									lanes={snapshot.lanes}
									elsewhere={snapshot.elsewhere}
									trunk={snapshot.trunk}
									here={{ root: snapshot.root, repo: snapshot.repo }}
									open={open}
									onOpen={openConversation}
									onLane={(id) => {
										openLane(id);
									}}
									onTodos={(ids) => {
										go("todos");
										todoView.filter(ids);
									}}
									phone={!wide}
								/>
							</TreesContext>
						),
					},
		[
			snapshot,
			drafts,
			todoView,
			lane,
			openLane,
			task,
			openTask,
			go,
			report,
			cred,
			talk,
			opens,
			rule,
			evals,
			openEval,
			setup,
			openSetup,
			available,
			terminals,
			open,
			wide,
			openConversation,
		],
	);
}
