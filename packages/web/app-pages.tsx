import type { Snapshot } from "@splates/server/tasks";
import { type ReactNode, useMemo } from "react";
import { BoardsPage } from "./boards-page";
import type { ConversationFeed } from "./conversation-feed";
import { Conversations } from "./conversations";
import { CredsPage } from "./creds";
import type { Drafts } from "./drafts";
import {
	AutoPickPage,
	BillingPage,
	EvalsPage,
	RecPage,
	SetupPage,
	ShipsPage,
	SignalsPage,
	StatsPage,
	Todos,
} from "./lazy-pages";
import type { Page, PageRoute } from "./page-route";
import type { StatsReport } from "./stats-report";
import { Tasks } from "./tasks";
import type { Terminals } from "./terminals";
import type { TodoView } from "./todo-view";
import { WelcomePage } from "./welcome-page";
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
	cell,
	evals,
	openEval,
	shipRun,
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
	| "cell"
	| "open"
	| "evals"
	| "openEval"
	| "shipRun"
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
						boards: (
							<BoardsPage
								snapshot={snapshot}
								onPick={() => go("todos", null, "replace")}
								onQueue={() => go("tasks")}
							/>
						),
						todos: (
							<>
								<Todos
									snapshot={snapshot}
									drafts={drafts}
									view={todoView}
									lane={lane}
									onLane={openLane}
									onIndex={() => go("boards")}
								/>
							</>
						),
						tasks: (
							<>
								<Tasks
									filter={todoView.taskFilter}
									project={snapshot}
									open={task}
									onOpen={openTask}
									onBoards={() => go("boards")}
									onOpenLane={openLane}
									onOpenTodo={(id) => {
										go("todos");
										todoView.open(id);
									}}
								/>
							</>
						),
						stats: <StatsPage report={report} />,
						ships: (
							<ShipsPage
								run={shipRun}
								snapshot={snapshot}
								talk={available ? talk : null}
							/>
						),
						rec: <RecPage feed={available ? talk : null} />,
						evals: (
							<EvalsPage
								open={evals}
								onOpen={openEval}
								feed={available ? talk : null}
							/>
						),
						creds: (
							<CredsPage
								requests={snapshot.creds}
								project={snapshot.repo}
								cred={cred}
							/>
						),
						signals: (
							<SignalsPage
								onOpen={(id) => openConversation(id)}
								opens={opens}
							/>
						),
						billing: <BillingPage talk={talk} />,
						"auto-pick": (
							<AutoPickPage
								mark={cell}
								tasks={snapshot.tasks}
								todos={snapshot.todos}
								opens={opens}
							/>
						),
						setup: (
							<SetupPage
								todos={snapshot.todos}
								feed={available ? talk : null}
								onOpen={openConversation}
								open={setup}
								onSetup={openSetup}
								onWelcome={() => go("welcome")}
							/>
						),
						welcome: (
							<WelcomePage
								onSetup={openSetup}
								onConversation={() => openConversation(null)}
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
									boards={snapshot.boards}
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
			cell,
			evals,
			openEval,
			shipRun,
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
