import type {
	ThreadComposerRuntime,
	TriggerAdapter,
	TriggerItem,
} from "@assistant-ui/react";
import {
	ColumnsIcon,
	GitBranchIcon,
	ListTodoIcon,
	type LucideIcon,
	SparklesIcon,
} from "lucide-react";
import { type ReactNode, useContext, useMemo } from "react";
import {
	CHECKPOINT,
	laneReference,
	RESUME,
	taskReference,
	todoReference,
} from "../prompts";
import type { Details } from "../show";
import type { Action } from "./actions";
import { Board } from "./board";
import { addDirective } from "./directives";

/**
 * What `#` offers in the composer, by category: picking an item adds its
 * directive as a chip, or runs it, for an action.
 */
export interface References {
	adapter: TriggerAdapter;
	pick: (item: TriggerItem) => void;
	icon: (item: TriggerItem) => ReactNode;
}

/** The categories, in the order the list shows them. */
const CATEGORIES = [
	{ id: "directive", label: "Directives", icon: SparklesIcon },
	{ id: "todo", label: "Todos", icon: ListTodoIcon },
	{ id: "lane", label: "Lanes", icon: ColumnsIcon },
	{ id: "task", label: "Tasks", icon: GitBranchIcon },
	{ id: "action", label: "Actions", icon: null },
] as const satisfies { id: string; label: string; icon: LucideIcon | null }[];

/** The directives that are about no todo, lane, or task. */
const DIRECTIVES = [
	{
		directive: CHECKPOINT,
		label: "Checkpoint",
		about: "update ARBOR.md and stop",
	},
	{ directive: RESUME, label: "Resume", about: "carry on from ARBOR.md" },
];

/**
 * The board's todos and lanes, `tasks`, the directives, and `actions` for `#`
 * in `composer`, the conversation's actions run in place.
 */
export function useReferences(
	composer: ThreadComposerRuntime,
	tasks: readonly Details[],
	actions: readonly Action[] = [],
): References {
	const { todos, lanes } = useContext(Board);
	return useMemo(() => {
		const runnable = actions.filter((action) => action.run !== null);
		const items: Record<string, TriggerItem[]> = {
			directive: DIRECTIVES.map(({ directive, label, about }) => ({
				id: directive,
				type: "directive",
				label,
				description: about,
				metadata: { directive },
			})),
			todo: todos.map((todo) => ({
				id: todoReference(todo.id),
				type: "todo",
				label: todo.subject,
				description: `#${todo.id}`,
				metadata: { directive: todoReference(todo.id) },
			})),
			lane: lanes.map((lane) => ({
				id: laneReference(lane.id),
				type: "lane",
				label: lane.name,
				description: `lane ${lane.id}`,
				metadata: { directive: laneReference(lane.id) },
			})),
			task: tasks.map((task) => ({
				id: taskReference(task.task),
				type: "task",
				label: task.task,
				description: task.status,
				metadata: { directive: taskReference(task.task) },
			})),
			action: runnable.map((action, index) => ({
				id: `action:${action.label}`,
				type: "action",
				label: action.label,
				metadata: { action: index },
			})),
		};
		return {
			adapter: {
				// Only those with something in them.
				categories: () =>
					CATEGORIES.filter(({ id }) => (items[id] ?? []).length > 0),
				categoryItems: (id) => items[id] ?? [],
			},
			pick: (item) => {
				const { directive, action } = item.metadata ?? {};
				if (typeof directive === "string") {
					addDirective(composer, directive);
				} else if (typeof action === "number") {
					runnable[action]?.run?.();
				}
			},
			icon: (item) => {
				const { action } = item.metadata ?? {};
				if (typeof action === "number") {
					return runnable[action]?.icon;
				}
				const Icon = CATEGORIES.find(({ id }) => id === item.type)?.icon;
				return Icon == null ? null : <Icon />;
			},
		};
	}, [composer, todos, lanes, tasks, actions]);
}
