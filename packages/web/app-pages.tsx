import type { Snapshot } from "@stringsync/splates-server/tasks";
import { type ReactNode, useMemo } from "react";
import type { ConversationFeed } from "./conversation-feed";
import { Conversations } from "./conversations";
import { CredsPage } from "./creds";
import type { Drafts } from "./drafts";
import {
	AutomationsPage,
	AutoPickPage,
	BudgetPage,
	EvalsPage,
	NotesPage,
	SetupPage,
	StatsPage,
	Todos,
	WorkersPage,
} from "./lazy-pages";
import type { Page, PageRoute } from "./page-route";
import type { StatsReport } from "./stats-report";
import { Tasks } from "./tasks";
import type { Terminals } from "./terminals";
import type { TodoView } from "./todo-view";
import { TreesContext } from "./work-row";

/** Cache page bodies independently of conversation stream consumers. */
export function useAppPages({
	snapshot,
	drafts,
	todoView,
	lane,
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
	available,
	terminals,
	open,
	wide,
	openConversation,
}: Pick<
	PageRoute,
	| "lane"
	| "task"
	| "openTask"
	| "go"
	| "cred"
	| "rule"
	| "open"
	| "evals"
	| "openEval"
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
	// What each page shows, laid out by the sidebar's tabs or the phone's own.
	const workerTasks = useMemo(
		() => new Set((snapshot?.tasks ?? []).map((each) => each.task)),
		[snapshot?.tasks],
	);
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
						notes: (
							<NotesPage
								feed={available ? talk : null}
								drafts={drafts}
								onOpen={openConversation}
							/>
						),
						stats: <StatsPage report={report} />,
						evals: <EvalsPage open={evals} onOpen={openEval} />,
						creds: (
							<CredsPage
								requests={snapshot.creds}
								project={snapshot.repo}
								cred={cred}
							/>
						),
						budget: <BudgetPage talk={talk} />,
						workers: (
							<WorkersPage
								tasks={workerTasks}
								onOpenTask={openTask}
								onOpenKeys={() => go("creds")}
							/>
						),
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
									trunk={snapshot.trunk}
									open={open}
									onOpen={openConversation}
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
			task,
			openTask,
			go,
			report,
			cred,
			talk,
			workerTasks,
			opens,
			rule,
			evals,
			openEval,
			available,
			terminals,
			open,
			wide,
			openConversation,
		],
	);
}
