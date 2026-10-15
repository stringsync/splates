import type { TriggerAdapter, TriggerItem } from "@assistant-ui/react";
import {
	BookmarkIcon,
	ColumnsIcon,
	GitBranchIcon,
	GitMergeIcon,
	HeartPulseIcon,
	LayersIcon,
	ListTodoIcon,
	type LucideIcon,
	PlayIcon,
	TreePineIcon,
} from "lucide-react";
import { type ReactNode, useContext, useMemo } from "react";
import {
	CHECKPOINT,
	HEARTBEAT,
	laneReference,
	MERGE,
	RESUME,
	taskReference,
	todoReference,
} from "../prompts";
import type { Details } from "../show";
import type { NamedSystem } from "../systems";
import type { Action } from "./actions";
import { Board } from "./board";
import type { Tone } from "./card-shell";

/**
 * What `#` offers in the composer, by category: picking an item writes it
 * as a chip in place of what was typed, its directive or a system, or runs
 * it, for an action.
 */
export interface References {
	adapter: TriggerAdapter;
	/** Runs an action. */
	pick: (item: TriggerItem) => void;
	icon: (item: TriggerItem) => ReactNode;
	/**
	 * An item as the composer writes it: a chip that reads as its directive,
	 * or `#name` for a system; null for an action, which `pick` runs instead.
	 */
	chip: (item: TriggerItem) => TriggerItem | null;
}

/** The categories, in the order the list shows them. */
const CATEGORIES = [
	{ id: "directive", label: "Directives", icon: TreePineIcon },
	{ id: "todo", label: "Todos", icon: ListTodoIcon },
	{ id: "lane", label: "Lanes", icon: ColumnsIcon },
	{ id: "task", label: "Tasks", icon: GitBranchIcon },
	{ id: "system", label: "Systems", icon: LayersIcon },
	{ id: "action", label: "Actions", icon: null },
] as const satisfies { id: string; label: string; icon: LucideIcon | null }[];

/**
 * The board's todos and lanes, `tasks`, `systems`, the directives, and
 * `actions` for `#` in the composer, the conversation's actions run in place.
 */
export function useReferences(
	tasks: readonly Details[],
	actions: readonly Action[] = [],
	systems: readonly NamedSystem[] = [],
): References {
	const { todos, lanes } = useContext(Board);
	return useMemo(() => {
		const runnable = actions.filter((action) => action.run !== null);
		const items: Record<string, TriggerItem[]> = {
			directive: BARE_DIRECTIVES.map(({ directive, label, about }) => ({
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
			lane: [
				{
					id: laneReference(null),
					type: "lane",
					label: "Untriaged",
					description: "todos in no lane",
					metadata: { directive: laneReference(null) },
				},
				...lanes.map((lane) => ({
					id: laneReference(lane.id),
					type: "lane",
					label: lane.name,
					description: `lane ${lane.id}`,
					metadata: { directive: laneReference(lane.id) },
				})),
			],
			task: tasks.map((task) => ({
				id: taskReference(task.task),
				type: "task",
				label: task.task,
				description: task.status,
				metadata: { directive: taskReference(task.task) },
			})),
			// Its aliases as its description, so typing one finds it too.
			system: systems.map((system) => ({
				id: `system:${system.name}`,
				type: "system",
				label: system.name,
				...((system.aliases ?? []).length > 0
					? { description: (system.aliases ?? []).join(", ") }
					: {}),
				metadata: { system: system.name },
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
				const { action } = item.metadata ?? {};
				if (typeof action === "number") {
					runnable[action]?.run?.();
				}
			},
			chip: (item) => {
				const { directive, system } = item.metadata ?? {};
				if (typeof directive === "string") {
					return { id: directive, type: "directive", label: directive };
				}
				return typeof system === "string"
					? { id: system, type: "system", label: system }
					: null;
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
	}, [todos, lanes, tasks, actions, systems]);
}

/**
 * The directives that are about no todo, lane, or task, as the composer offers
 * them and a message of one alone shows as its card.
 */
export const BARE_DIRECTIVES = [
	{
		directive: CHECKPOINT,
		label: "Checkpoint",
		about: "update ARBOR.md and stop",
		icon: BookmarkIcon,
		tone: "neutral",
	},
	{
		directive: RESUME,
		label: "Resume",
		about: "carry on from ARBOR.md",
		icon: PlayIcon,
		tone: "neutral",
	},
	{
		directive: HEARTBEAT,
		label: "Heartbeat",
		about: "check on the agents it handed tasks to",
		icon: HeartPulseIcon,
		tone: "neutral",
	},
	{
		directive: MERGE,
		label: "Merge",
		about: "merge the task it had reviewed",
		icon: GitMergeIcon,
		tone: "success",
	},
] as const satisfies {
	directive: string;
	label: string;
	about: string;
	icon: LucideIcon;
	tone: Tone;
}[];
