import type { ConversationState } from "../conversations";
import { goalLine } from "../plan";
import type { Details } from "../show";
import type { TodoState } from "../todo";
import { nameOf } from "./conversation-names";

/** What ⌘K searches: the shown project's, since the page holds no other's. */
export interface Searched {
	tasks: Details[];
	todos: TodoState[];
	conversations: ConversationState[];
}

export type Kind = "task" | "conversation" | "todo";

/** One thing found, and how well: the higher `score`, the better the match. */
export type Found = {
	/** Unique across kinds, for a React key. */
	key: string;
	title: string;
	/** A line under the title: where the words were found, or what it is. */
	detail: string | null;
	score: number;
	/** When it last moved, which breaks a tie in score; null when unknown. */
	at: string | null;
} & (
	| { kind: "task"; task: string }
	| { kind: "conversation"; conversation: string }
	| { kind: "todo"; todo: number }
);

/** One kind's matches, best first. */
export interface Group {
	kind: Kind;
	found: Found[];
}

/** The order kinds go in when their best matches tie, and with no words. */
const KINDS: Kind[] = ["task", "conversation", "todo"];

/** How many of each kind an empty search lists. */
const UNASKED = 3;
/** How many of each kind a search lists at most. */
const LISTED = 8;
/** How much of a body a snippet shows either side of the words. */
const AROUND = 40;

/**
 * Where a word lands in a title scores it: the whole title, its start, the
 * start of a word in it, anywhere in it, and last only in the body.
 */
const WHOLE = 100;
const START = 80;
const WORD = 60;
const ANYWHERE = 40;
const BODY = 20;

/**
 * Everything in `searched` that `query` matches, grouped by kind: groups by
 * their best match, each best first and then the latest. An empty query lists what wants the person first, then the latest of each.
 */
export function search(query: string, searched: Searched): Group[] {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return unasked(searched);
	}
	const candidates = [
		...searched.tasks.map(taskOf),
		...searched.conversations.map(conversationOf),
		...searched.todos.map(todoOf),
	];
	const groups: Group[] = [];
	for (const kind of KINDS) {
		const found = candidates
			.filter((each) => each.found.kind === kind)
			.flatMap(({ found, body }) => {
				const scored = scoreOf(words, found.title, body);
				return scored === null ? [] : [{ ...found, ...scored }];
			})
			.sort(
				(one, other) =>
					other.score - one.score ||
					(other.at ?? "").localeCompare(one.at ?? ""),
			)
			.slice(0, LISTED);
		if (found.length > 0) {
			groups.push({ kind, found });
		}
	}
	// Stable, so groups that tie keep KINDS' order.
	return groups.sort(
		(one, other) => (other.found[0]?.score ?? 0) - (one.found[0]?.score ?? 0),
	);
}

/** Something to match: what it is, and the words beyond its title. */
interface Candidate {
	found: Found;
	body: string;
}

function taskOf(task: Details): Candidate {
	return {
		found: {
			kind: "task",
			key: `task:${task.task}`,
			task: task.task,
			title: task.task,
			detail: (task.plan === null ? null : goalLine(task.plan)) ?? task.status,
			score: 0,
			at: task.escalatedAt ?? task.createdAt,
		},
		body: task.plan ?? "",
	};
}

function conversationOf(conversation: ConversationState): Candidate {
	const said = conversation.messages
		.flatMap((message) =>
			message.parts.flatMap((part) =>
				part.type === "text" ? [part.text] : [],
			),
		)
		.join("\n");
	return {
		found: {
			kind: "conversation",
			key: `conversation:${conversation.id}`,
			conversation: conversation.id,
			title: nameOf(conversation),
			detail: conversation.archived ? "Archived" : null,
			score: 0,
			at: latest(conversation),
		},
		body: said,
	};
}

function todoOf(todo: TodoState): Candidate {
	return {
		found: {
			kind: "todo",
			key: `todo:${todo.id}`,
			todo: todo.id,
			title: todo.subject,
			detail:
				todo.takenBy === null
					? `#${todo.id}`
					: `#${todo.id} in ${todo.takenBy}`,
			score: 0,
			at: todo.createdAt,
		},
		body: todo.text,
	};
}

/** When a conversation last moved: its latest message, else when it began. */
function latest(conversation: ConversationState): string {
	for (let at = conversation.messages.length - 1; at >= 0; at--) {
		const moved =
			conversation.messages[at]?.until ?? conversation.messages[at]?.at;
		if (moved) {
			return moved;
		}
	}
	return conversation.createdAt;
}

/**
 * How well `words` match: each must be found in the title or the body, and
 * the match scores as its weakest word. Found only in the body, the detail
 * becomes a snippet around the first word there.
 */
function scoreOf(
	words: string[],
	title: string,
	body: string,
): { score: number; detail?: string } | null {
	if (words.length === 0) {
		return { score: WHOLE };
	}
	const lower = title.toLowerCase();
	const phrase = words.join(" ");
	if (lower === phrase) {
		return { score: WHOLE };
	}
	let score = Number.POSITIVE_INFINITY;
	let snippet: string | undefined;
	for (const word of words) {
		const scored = inTitle(lower, word);
		if (scored !== null) {
			score = Math.min(score, scored);
			continue;
		}
		const at = body.toLowerCase().indexOf(word);
		if (at === -1) {
			return null;
		}
		score = Math.min(score, BODY);
		snippet ??= snippetOf(body, at, word.length);
	}
	return snippet === undefined ? { score } : { score, detail: snippet };
}

function inTitle(title: string, word: string): number | null {
	if (title.startsWith(word)) {
		return START;
	}
	if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(word)}`, "u").test(title)) {
		return WORD;
	}
	return title.includes(word) ? ANYWHERE : null;
}

function escaped(word: string): string {
	return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One line of `body` around `length` characters at `at`. */
function snippetOf(body: string, at: number, length: number): string {
	const from = Math.max(0, at - AROUND);
	const to = Math.min(body.length, at + length + AROUND);
	const line = body.slice(from, to).replace(/\s+/g, " ").trim();
	return `${from > 0 ? "…" : ""}${line}${to < body.length ? "…" : ""}`;
}

/**
 * With nothing typed: escalated tasks and conversations waiting on the person
 * first, then the latest of each kind.
 */
function unasked(searched: Searched): Group[] {
	const recent = (one: Found, other: Found) =>
		(other.at ?? "").localeCompare(one.at ?? "");
	const tasks = searched.tasks
		.map(taskOf)
		.map(({ found }) => found)
		.sort(recent);
	const escalated = new Set(
		searched.tasks
			.filter((task) => task.escalation !== null)
			.map((task) => task.task),
	);
	const conversations = searched.conversations
		.filter((each) => !each.archived)
		.map((each) => ({
			waiting: each.ask !== null || each.unread,
			...conversationOf(each),
		}));
	const groups: Group[] = [
		{
			kind: "task",
			found: [
				...tasks.filter(
					(found) => found.kind === "task" && escalated.has(found.task),
				),
				...tasks.filter(
					(found) => found.kind === "task" && !escalated.has(found.task),
				),
			].slice(0, UNASKED),
		},
		{
			kind: "conversation",
			found: [
				...conversations
					.filter((each) => each.waiting)
					.map(({ found }) => found)
					.sort(recent),
				...conversations
					.filter((each) => !each.waiting)
					.map(({ found }) => found)
					.sort(recent),
			].slice(0, UNASKED),
		},
		{
			kind: "todo",
			found: [...searched.todos]
				.sort((one, other) => one.position - other.position)
				.map((todo) => todoOf(todo).found)
				.slice(0, UNASKED),
		},
	];
	return groups.filter((group) => group.found.length > 0);
}
