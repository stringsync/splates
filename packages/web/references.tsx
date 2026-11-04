import type { TriggerAdapter, TriggerItem } from "@assistant-ui/react";
import type { ProjectRef } from "@splates/server/conversations";
import { nameOf } from "@splates/server/conversations/browser";
import {
	APPROVE,
	CHECKPOINT,
	DEFER,
	EVALS_BUDGET_USED_UP,
	GRANT_DENIED,
	GRANTED,
	MERGE,
	RECONNECT,
	RESUME,
	RETRIED,
	RUN_ALLOWED,
	RUN_DENIED,
	RUN_ELSEWHERE,
	taskNumberReference,
	taskReference,
} from "@splates/server/plans/browser";
import type { RecSessionSummary } from "@splates/server/rec/browser";
import type { Details } from "@splates/server/tasks";
import {
	BanIcon,
	BookmarkIcon,
	ClockIcon,
	FolderGit2Icon,
	GitMergeIcon,
	KeyRoundIcon,
	LightbulbIcon,
	ListTodoIcon,
	type LucideIcon,
	MessageCircleIcon,
	MonitorOffIcon,
	PlayIcon,
	PlugIcon,
	RotateCcwIcon,
	TerminalIcon,
	UtensilsIcon,
	VideoIcon,
} from "lucide-react";
import { type ReactNode, useContext, useMemo } from "react";
import type { Action } from "./actions";
import { Board } from "./board";
import type { Tone } from "./card-shell";
import { Lanes } from "./conversation-names";
import { FinishedReferences } from "./finished-references";
import { useHeldConversations } from "./handed-out";
import { TaskIcon } from "./task-icon";

/**
 * What `#` offers in the composer, by category: picking an item writes it
 * as a chip in place of what was typed, its directive or a
 * project, or runs it, for an action.
 */
export interface References {
	adapter: TriggerAdapter;
	/** Runs an action. */
	pick: (item: TriggerItem) => void;
	icon: (item: TriggerItem) => ReactNode;
	/**
	 * An item as the composer writes it: a chip that reads as its directive,
	 * or `#name` for a project; null for an action, which `pick`
	 * runs instead.
	 */
	chip: (item: TriggerItem) => TriggerItem | null;
}

/** The categories, in the order the list shows them. */
const CATEGORIES = [
	{ id: "directive", label: "Directives", icon: UtensilsIcon },
	{ id: "todo", label: "Board", icon: ListTodoIcon },
	{ id: "task", label: "Tasks", icon: TaskIcon },
	{ id: "conversation", label: "Conversations", icon: MessageCircleIcon },
	{ id: "project", label: "Projects", icon: FolderGit2Icon },
	{ id: "rec", label: "Rec sessions", icon: VideoIcon },
	{ id: "action", label: "Actions", icon: null },
] as const satisfies { id: string; label: string; icon: LucideIcon | null }[];

/**
 * The board's todos, `tasks`, the other splates
 * `projects` on this machine, the directives, and `actions` for `#` in the
 * composer, the conversation's actions run in place.
 */
export function useReferences(
	tasks: readonly Details[],
	actions: readonly Action[] = [],
	projects: readonly ProjectRef[] = [],
	recSessions: readonly RecSessionSummary[] = [],
): References {
	const { todos } = useContext(Board);
	const finished = useContext(FinishedReferences);
	const conversations = useHeldConversations();
	const namedLanes = useContext(Lanes);
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
			todo: [
				...todos,
				// A finished task answers to its own number and to each queued
				// task it took up, which kept its number.
				...finished
					.flatMap((task) => [
						{ id: task.id, subject: task.subject },
						...task.took,
					])
					.filter(
						(each, index, all) =>
							all.findIndex((other) => other.id === each.id) === index &&
							!todos.some((todo) => todo.id === each.id),
					),
			].map((todo) => ({
				id: taskNumberReference(todo.id),
				type: "todo",
				label: todo.subject,
				description: `#${todo.id}`,
				metadata: { directive: taskNumberReference(todo.id) },
			})),
			task: [
				...tasks,
				...finished
					.filter((task) => !tasks.some((live) => live.task === task.task))
					.map((task) => ({ task: task.task, status: task.ended })),
			]
				.filter(
					(task, index, all) =>
						all.findIndex((each) => each.task === task.task) === index,
				)
				.map((task) => ({
					id: taskReference(task.task),
					type: "task",
					label: task.task,
					description: task.status,
					metadata: { directive: taskReference(task.task) },
				})),
			conversation: conversations.map((conversation) => ({
				id: conversation.id,
				type: "conversation",
				label: nameOf(conversation, namedLanes),
				description: `${conversation.archived ? "Archived · " : ""}${conversation.id}`,
				metadata: { conversation: conversation.id },
			})),
			// Its directory as its description, which the agent is told too.
			project: projects.map((project) => ({
				id: `project:${project.slug}`,
				type: "project",
				label: project.slug,
				description: project.root,
				metadata: { project: project.slug },
			})),
			// Its age, length and moments as the description.
			rec: recSessions.map((session) => ({
				id: `rec:${session.name}`,
				type: "rec",
				label: session.name,
				description: describeSession(session),
				metadata: { rec: session.name },
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
				// An empty category would be a heading with nothing to pick under it.
				categories: () =>
					CATEGORIES.filter(({ id }) => (items[id] ?? []).length > 0),
				categoryItems: (id) => items[id] ?? [],
			},
			pick: (item) => {
				const { action } = item.metadata ?? {};
				if (typeof action === "number") {
					if (!runnable[action]?.pending) {
						runnable[action]?.run?.();
					}
				}
			},
			chip: (item) => {
				const { directive, project, conversation, rec } = item.metadata ?? {};
				if (typeof rec === "string") {
					return { id: `rec:${rec}`, type: "rec", label: rec };
				}
				if (typeof conversation === "string") {
					return { id: conversation, type: "conversation", label: item.label };
				}
				if (typeof directive === "string") {
					return { id: directive, type: "directive", label: directive };
				}
				if (typeof project === "string") {
					return { id: project, type: "project", label: project };
				}
				return null;
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
	}, [
		todos,
		tasks,
		actions,
		projects,
		recSessions,
		conversations,
		namedLanes,
		finished,
	]);
}

/** "3h ago · 2m 5s · 4 moments". */
function describeSession(session: RecSessionSummary): string {
	const minutes = Math.floor((Date.now() - session.startedAt) / 60_000);
	const age =
		minutes < 1
			? "just now"
			: minutes < 60
				? `${minutes}m ago`
				: minutes < 1440
					? `${Math.floor(minutes / 60)}h ago`
					: `${Math.floor(minutes / 1440)}d ago`;
	const seconds = Math.round(session.length);
	const length =
		seconds < 60
			? `${seconds}s`
			: `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return `${age} · ${length} · ${session.moments} ${session.moments === 1 ? "moment" : "moments"}`;
}

/**
 * The directives that are about no todo or task, as the composer offers
 * them and a message of one alone shows as its card.
 */
export const BARE_DIRECTIVES = [
	{
		directive: CHECKPOINT,
		label: "Checkpoint",
		about: "update SPLATES.md and stop",
		icon: BookmarkIcon,
		tone: "neutral",
	},
	{
		directive: RESUME,
		label: "Resume",
		about: "carry on from SPLATES.md",
		icon: PlayIcon,
		tone: "neutral",
	},
	{
		directive: RECONNECT,
		label: "Reconnect",
		about: "carry on with a turn a lost connection cut short",
		icon: PlugIcon,
		tone: "neutral",
	},
	{
		directive: DEFER,
		label: "Put back on board",
		about: "put the request on the board rather than do it",
		icon: ClockIcon,
		tone: "neutral",
	},
	{
		directive: MERGE,
		label: "Merge",
		about: "merge the task it had reviewed",
		icon: GitMergeIcon,
		tone: "success",
	},
	{
		directive: APPROVE,
		label: "Approve",
		about: "go ahead with the proposal it made",
		icon: LightbulbIcon,
		tone: "success",
	},
	{
		directive: RETRIED,
		label: "Merge attempts granted",
		about: "merge again with the attempts the person granted its task",
		icon: RotateCcwIcon,
		tone: "success",
	},
	{
		directive: GRANTED,
		label: "Reach granted",
		about: "carry on with the reach the person granted its grant card",
		icon: KeyRoundIcon,
		tone: "success",
	},
	{
		directive: GRANT_DENIED,
		label: "Reach denied",
		about: "carry on without the reach the person denied its grant card",
		icon: BanIcon,
		tone: "warning",
	},
	{
		directive: RUN_ALLOWED,
		label: "Run allowed",
		about: "run the command the last run-command card asked to",
		icon: TerminalIcon,
		tone: "success",
	},
	{
		directive: RUN_ELSEWHERE,
		label: "Not on this device",
		about:
			"carry on without rec: the person is not at the machine that can run it",
		icon: MonitorOffIcon,
		tone: "neutral",
	},
	{
		directive: RUN_DENIED,
		label: "Run denied",
		about:
			"carry on without the command the last run-command card asked to run",
		icon: BanIcon,
		tone: "neutral",
	},
	{
		directive: EVALS_BUDGET_USED_UP,
		label: "Evals budget used up",
		about:
			"stop and report: the run evals card was refused because the budget is used up, and only the user tops it up",
		icon: BanIcon,
		tone: "warning",
	},
] as const satisfies {
	directive: string;
	label: string;
	about: string;
	icon: LucideIcon;
	tone: Tone;
}[];
