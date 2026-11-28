import type { TaskRecord } from "@splates/server/board/browser";
import type { ConversationState } from "@splates/server/conversations";
import { queuedIn } from "./conversation-address";
import { lastReport } from "./conversation-names";
import { flatten } from "./conversation-rows";
import { deferredTask } from "./deferred-body";
import { type Folder, folderKey } from "./project-folders";

/** A sidebar row that can trigger blocker highlighting when hovered or selected. */
export type BlockerSource =
	| { kind: "queued"; folder: string; todoId: number }
	| { kind: "conversation"; folder: string; conversationId: string };

/**
 * Sidebar rows holding a blocker of the active source, mapped from their
 * `<folderKey>:<id>` key to the blocker's board task number.
 */
export interface HighlightedBlockers {
	readonly source: BlockerSource | null;
	readonly conversations: ReadonlyMap<string, number>;
	readonly queued: ReadonlyMap<string, number>;
}

const EMPTY: HighlightedBlockers = {
	source: null,
	conversations: new Map(),
	queued: new Map(),
};

/** Composite key for a conversation or queued task inside `folder`. */
export function blockerRowKey(folder: string, id: string | number): string {
	return `${folder}:${id}`;
}

/**
 * Resolves which sidebar rows hold the open blockers of the hovered or
 * selected blocked row. Hovering a blocked row takes precedence over the
 * selection; hovering an unblocked row leaves a selected blocked row active
 * so moving the pointer to click a highlighted blocker does not clear it.
 */
export function resolveSidebarBlockers(
	folders: readonly Folder[],
	open: string | null,
	hovered: BlockerSource | null,
): HighlightedBlockers {
	if (hovered !== null) {
		const fromHover = highlightsFor(folders, hovered);
		if (fromHover !== null) {
			return fromHover;
		}
	}
	const selected = selectedSource(folders, open);
	if (selected !== null) {
		const fromSelected = highlightsFor(folders, selected);
		if (fromSelected !== null) {
			return fromSelected;
		}
	}
	return EMPTY;
}

/** The `BlockerSource` corresponding to the currently open sidebar address, if any. */
function selectedSource(
	folders: readonly Folder[],
	open: string | null,
): BlockerSource | null {
	if (open === null) {
		return null;
	}
	const here = folders.find((folder) => folder.here);
	if (here === undefined) {
		return null;
	}
	const key = folderKey(here);
	const queuedId = queuedIn(open);
	if (queuedId !== null) {
		return { kind: "queued", folder: key, todoId: queuedId };
	}
	return { kind: "conversation", folder: key, conversationId: open };
}

/** A blocker task to match against sidebar rows in a target folder. */
interface OpenBlocker {
	folder: Folder;
	todoId: number;
	todo: TaskRecord | undefined;
}

/** Resolves blocker highlights for `source`, or null when `source` has no open blockers. */
function highlightsFor(
	folders: readonly Folder[],
	source: BlockerSource,
): HighlightedBlockers | null {
	const folder = folders.find((each) => folderKey(each) === source.folder);
	if (folder === undefined) {
		return null;
	}
	const todos = todosOf(folder);
	const sourceTodo = sourceTodoOf(folder, todos, source);
	if (sourceTodo === null) {
		return null;
	}
	const openBlockers = openBlockersOf(folders, folder, todos, sourceTodo);
	if (openBlockers.length === 0) {
		return null;
	}

	const conversations = new Map<string, number>();
	const queued = new Map<string, number>();

	for (const blocker of openBlockers) {
		const targetKey = folderKey(blocker.folder);
		const targetTodos = todosOf(blocker.folder);
		const listedConversations = flatten(blocker.folder.listed).flatMap((row) =>
			row.conversation === null ? [] : [row.conversation],
		);

		let matchedConversation = false;
		for (const conv of listedConversations) {
			if (
				conversationHoldsBlocker(
					conv,
					blocker.todoId,
					blocker.todo,
					targetTodos,
				)
			) {
				const key = blockerRowKey(targetKey, conv.id);
				if (!conversations.has(key)) {
					conversations.set(key, blocker.todoId);
				}
				matchedConversation = true;
			}
		}

		if (!matchedConversation) {
			const queuedRow = blocker.folder.queue.find(
				(each) => each.todo.id === blocker.todoId,
			);
			if (queuedRow !== undefined) {
				const key = blockerRowKey(targetKey, queuedRow.todo.id);
				if (!queued.has(key)) {
					queued.set(key, blocker.todoId);
				}
			}
		}
	}

	return { source, conversations, queued };
}

/** All board todos known for `folder`, falling back to its queued entries when absent. */
function todosOf(folder: Folder): readonly TaskRecord[] {
	return folder.todos ?? folder.queue.map((each) => each.todo);
}

/** The board task backing `source`, when it represents a queued or deferred blocked row. */
function sourceTodoOf(
	folder: Folder,
	todos: readonly TaskRecord[],
	source: BlockerSource,
): TaskRecord | null {
	if (source.kind === "queued") {
		const row = folder.queue.find((each) => each.todo.id === source.todoId);
		return row?.blockedBy !== null && row !== undefined ? row.todo : null;
	}
	const conv = flatten(folder.listed).find(
		(row) => row.conversation?.id === source.conversationId,
	)?.conversation;
	if (conv === undefined || conv === null) {
		return null;
	}
	const heldId = conv.heldForTask ?? conv.queuedTask;
	if (heldId != null) {
		const held = todos.find((each) => each.id === heldId);
		if (
			held !== undefined &&
			held.takenBy === null &&
			held.stage === "queued"
		) {
			return held;
		}
	}
	const report = lastReport(conv);
	if (report?.ending === "deferred") {
		const deferred = deferredTask(todos, report.task);
		if (deferred !== null && deferred.takenBy === null) {
			return deferred;
		}
	}
	return null;
}

/** Open same-project and cross-project blockers of `sourceTodo`. */
function openBlockersOf(
	folders: readonly Folder[],
	folder: Folder,
	todos: readonly TaskRecord[],
	sourceTodo: TaskRecord,
): OpenBlocker[] {
	const result: OpenBlocker[] = [];
	for (const id of sourceTodo.blockedBy) {
		const match = todos.find((each) => each.id === id);
		if (match !== undefined) {
			result.push({ folder, todoId: id, todo: match });
		}
	}
	for (const elsewhere of sourceTodo.blockedElsewhere ?? []) {
		if (elsewhere.landed !== undefined || elsewhere.lost) {
			continue;
		}
		const otherFolder = folders.find(
			(each) =>
				elsewhere.project !== undefined && each.root === elsewhere.project,
		);
		if (otherFolder !== undefined) {
			const otherTodos = todosOf(otherFolder);
			const match = otherTodos.find((each) => each.id === elsewhere.id);
			result.push({ folder: otherFolder, todoId: elsewhere.id, todo: match });
		}
	}
	return result;
}

/** Whether `conversation` currently holds or represents `todoId`. */
function conversationHoldsBlocker(
	conversation: ConversationState,
	todoId: number,
	todo: TaskRecord | undefined,
	todos: readonly TaskRecord[],
): boolean {
	if (
		conversation.heldForTask === todoId ||
		conversation.queuedTask === todoId
	) {
		return true;
	}
	if (todo?.takenBy != null) {
		if (conversation.task === todo.takenBy) {
			return true;
		}
		if (conversation.task === null && conversation.lastTask === todo.takenBy) {
			return true;
		}
	}
	const report = lastReport(conversation);
	if (report?.ending === "deferred") {
		const deferred = deferredTask(todos, report.task);
		if (deferred?.id === todoId) {
			return true;
		}
	}
	return false;
}
