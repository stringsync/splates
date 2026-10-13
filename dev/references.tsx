import type {
	ThreadComposerRuntime,
	TriggerAdapter,
	TriggerItem,
} from "@assistant-ui/react";
import {
	ColumnsIcon,
	GitBranchIcon,
	LayersIcon,
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
import type { NamedSystem } from "../systems";
import type { Action } from "./actions";
import { Board } from "./board";
import { addDirective } from "./directives";

/**
 * What `#` offers in the composer, by category: picking an item adds its
 * directive as a chip, or runs it, for an action, or writes it in place of
 * what was typed, for a system.
 */
export interface References {
	adapter: TriggerAdapter;
	pick: (item: TriggerItem) => void;
	icon: (item: TriggerItem) => ReactNode;
	/**
	 * Writes a system as `#name` in place of `typed`, the `#` and what follows
	 * it, the last before `caret`, and gives where the caret belongs after it;
	 * null for any other item, which `pick` takes instead.
	 */
	write: (item: TriggerItem, typed: string, caret: number) => number | null;
	/**
	 * The systems the words just before `caret` call by name or alias without
	 * a `#`, each with the words that called it, for the composer to offer as
	 * `#name`; none while the caret is inside a word.
	 */
	named: (text: string, caret: number) => Named[];
}

/** A system called by name without a `#`, and the words that called it. */
export interface Named {
	item: TriggerItem;
	typed: string;
}

/** The categories, in the order the list shows them. */
const CATEGORIES = [
	{ id: "directive", label: "Directives", icon: SparklesIcon },
	{ id: "todo", label: "Todos", icon: ListTodoIcon },
	{ id: "lane", label: "Lanes", icon: ColumnsIcon },
	{ id: "task", label: "Tasks", icon: GitBranchIcon },
	{ id: "system", label: "Systems", icon: LayersIcon },
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
 * The board's todos and lanes, `tasks`, `systems`, the directives, and
 * `actions` for `#` in `composer`, the conversation's actions run in place.
 */
export function useReferences(
	composer: ThreadComposerRuntime,
	tasks: readonly Details[],
	actions: readonly Action[] = [],
	systems: readonly NamedSystem[] = [],
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
				const { directive, action } = item.metadata ?? {};
				if (typeof directive === "string") {
					addDirective(composer, directive);
				} else if (typeof action === "number") {
					runnable[action]?.run?.();
				}
			},
			write: (item, typed, caret) => {
				const { system } = item.metadata ?? {};
				if (typeof system !== "string") {
					return null;
				}
				const text = composer.getState().text;
				const start = text.lastIndexOf(typed, caret - typed.length);
				const at = start === -1 ? text.length : start;
				const after = text.slice(start === -1 ? at : at + typed.length);
				const written = `#${system}`;
				composer.setText(
					text.slice(0, at) +
						written +
						(after.startsWith(" ") ? after : ` ${after}`),
				);
				return at + written.length + 1;
			},
			named: (text, caret) => named(systems, items.system ?? [], text, caret),
			icon: (item) => {
				const { action } = item.metadata ?? {};
				if (typeof action === "number") {
					return runnable[action]?.icon;
				}
				const Icon = CATEGORIES.find(({ id }) => id === item.type)?.icon;
				return Icon == null ? null : <Icon />;
			},
		};
	}, [composer, todos, lanes, tasks, actions, systems]);
}

/** What a name ends at: the end, or anything but a letter, digit, `-` or `_`. */
const ENDS = /^(?:$|[^\p{L}\p{N}_-])/u;
/** What a name starts after: the start, a space, or an opening mark. */
const STARTS = /(?:^|[\s("'`[{])$/u;

function named(
	systems: readonly NamedSystem[],
	items: readonly TriggerItem[],
	text: string,
	caret: number,
): Named[] {
	if (!ENDS.test(text.slice(caret))) {
		return [];
	}
	const before = text.slice(0, caret);
	const lower = before.toLowerCase();
	const found: Named[] = [];
	systems.forEach((system, index) => {
		const item = items[index];
		const called = [system.name, ...(system.aliases ?? [])].find(
			(called) =>
				lower.endsWith(called.toLowerCase()) &&
				STARTS.test(before.slice(0, before.length - called.length)),
		);
		if (item !== undefined && called !== undefined) {
			found.push({ item, typed: before.slice(before.length - called.length) });
		}
	});
	return found;
}
