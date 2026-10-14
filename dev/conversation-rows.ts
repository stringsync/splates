import type { ConversationState } from "../conversations";
import { type Need, type Needing, need, needs } from "../needs";
import type { Details } from "../show";
import { NEW } from "./conversation-address";
import { reportedAs } from "./conversation-names";
import type { Drafts } from "./drafts";
import { isPartOf, type Nested } from "./parts";
import { arriveAt, questionsSeen, replyCopied, TASK } from "./task-view";
import { unanswered } from "./unanswered";

/** The sidebar's rows, newest first: the conversations listed, then external agents. */
export function rowsOf(
	tasks: Details[],
	conversations: ConversationState[],
): Needing[] {
	const external = needs({ tasks, conversations }).filter(
		(each) => each.conversation === null,
	);
	return [
		...conversations
			.filter((each) => !each.archived)
			.map((conversation) => ({
				conversation,
				task: null,
				need: needOf(tasks, conversation),
			})),
		...external,
	].toSorted((one, other) => started(other).localeCompare(started(one)));
}

/** Nested rows in the order they show, each part under its task. */
export function flatten<Row>(rows: Nested<Row>[]): Row[] {
	return rows.flatMap(({ row, parts }) => [row, ...flatten(parts)]);
}

/** The digit that opens `row` with ⌥⌘, or null past the tenth. */
export function hintOf(shown: Needing[], row: Needing): string | null {
	const at = shown.indexOf(row);
	return at === -1 ? null : String(at);
}

/** What opens `row`: its conversation's id, or its external agent's task. */
export function openedBy(row: Needing): string {
	return row.conversation?.id ?? `${TASK}${row.task?.task ?? ""}`;
}

/**
 * The next of `rows` that waits on you after the one `open` shows, around to
 * the top, or with `settled` and none waiting, the next merged one, then the
 * next unread one: what ⌥⌘M opens. The one open comes last, so ⌥⌘M on the
 * only one waiting goes back to its questions.
 */
export function nextWaiting(
	rows: Needing[],
	drafts: Drafts,
	open: string | null,
	settled = false,
): Needing | undefined {
	const at = rows.findIndex((row) => openedBy(row) === open);
	const around = [...rows.slice(at + 1), ...rows.slice(0, at + 1)];
	const waiting = around.find((row) => waitsOnYou(row, drafts));
	if (waiting !== undefined || !settled) {
		return waiting;
	}
	return around.find(wasMerged) ?? around.find(isUnread);
}

/**
 * Once the conversation `open` shows is archived, on to the next agent
 * waiting on you, or a new conversation with none.
 */
export function goOn(
	rows: Needing[],
	drafts: Drafts,
	open: string | null,
	onOpen: (id: string) => void,
): void {
	const waiting = nextWaiting(rows, drafts, open);
	if (waiting === undefined || openedBy(waiting) === open) {
		onOpen(NEW);
	} else {
		arriveAt(openedBy(waiting));
		onOpen(openedBy(waiting));
	}
}

/** Whether `row` shows as merged in the sidebar. */
function wasMerged({ conversation, need }: Needing): boolean {
	return (
		conversation !== null &&
		reportedAs(conversation) === "merged" &&
		(need.kind === "idle" ||
			(need.kind === "waiting" && need.why !== "ask" && need.why !== "failed"))
	);
}

/** Whether `row` shows as unread in the sidebar. */
function isUnread({ conversation, need }: Needing): boolean {
	return (
		conversation?.unread === true &&
		need.kind === "idle" &&
		reportedAs(conversation) !== "escalated"
	);
}

/**
 * Whether ⌥⌘M stops on `row`: an agent stopped on you, or an external one
 * asking as it works, while it has questions no reply has answered yet, nor
 * for an external agent, seen in its view or copied. One the page runs asks as it works only in
 * its plan, until its report asks again as it stops.
 */
export function waitsOnYou(
	{ conversation, task, need }: Needing,
	drafts: Drafts,
): boolean {
	if (seenFor(drafts, conversation, task, need)) {
		return false;
	}
	if (need.kind === "waiting" && need.why !== "questions") {
		return true;
	}
	if (
		need.kind === "idle" ||
		need.kind === "working" ||
		(need.kind === "assuming" && conversation !== null)
	) {
		return false;
	}
	return unanswered(need.questions, conversation?.messages ?? []).length > 0;
}

/**
 * The task a sidebar row is on, or its conversation last ran in, which its
 * parts nest under: so a part stays under its caller once either merges.
 */
export function lastTaskOfRow(row: Needing): string | null {
	return row.conversation?.lastTask ?? row.task?.task ?? null;
}

/**
 * The branch a row's task, or the one its conversation last ran in, was cut
 * from: what it remembers, else what the task says, as for a conversation
 * from before it remembered.
 */
function baseOfRow(tasks: Details[], row: Needing): string | null {
	const task = lastTaskOfRow(row);
	return (
		row.conversation?.lastBase ??
		tasks.find((each) => each.task === task)?.base ??
		null
	);
}

/**
 * The conversation whose agent added a row's task, or the one its
 * conversation last ran in: what it remembers, else what the task says.
 */
function callerOfRow(tasks: Details[], row: Needing): string | null {
	const task = lastTaskOfRow(row);
	return (
		row.conversation?.lastCaller ??
		tasks.find((each) => each.task === task)?.caller ??
		null
	);
}

/**
 * Whether `part` nests under `host`: its task is a part of host's, or host's
 * agent added it, as when it handed a subagent a task that lands on trunk.
 */
export function isHostOf(
	tasks: Details[],
	host: Needing,
	part: Needing,
): boolean {
	const caller = callerOfRow(tasks, part);
	return (
		isPartOf(baseOfRow(tasks, part), lastTaskOfRow(host)) ||
		(caller !== null &&
			caller === host.conversation?.id &&
			caller !== part.conversation?.id)
	);
}

/** A row's key: its conversation's id, or its external agent's task. */
export function keyOfRow(row: Needing): string {
	return row.conversation?.id ?? `external ${row.task?.task ?? ""}`;
}

/** Whether a row is an external agent whose reply was copied, to paste. */
export function copiedFor(
	drafts: Drafts,
	conversation: ConversationState | null,
	task: Details | null,
	need: Need,
): boolean {
	return (
		conversation === null &&
		task !== null &&
		replyCopied(drafts, task.task, need)
	);
}

/**
 * Whether a row is an external agent whose open questions were seen in its
 * view, or their reply copied: it waits on you no longer.
 */
export function seenFor(
	drafts: Drafts,
	conversation: ConversationState | null,
	task: Details | null,
	need: Need,
): boolean {
	return (
		conversation === null &&
		task !== null &&
		(questionsSeen(drafts, task.task, need) ||
			replyCopied(drafts, task.task, need))
	);
}

/** When a row's conversation or task began; a task from before that, never. */
export function started(row: Needing): string {
	return row.conversation?.createdAt ?? row.task?.createdAt ?? "";
}

/** What a conversation needs, from the task it runs in, if any. */
export function needOf(
	tasks: Details[],
	conversation: ConversationState,
): Need {
	const task =
		conversation.task === null
			? null
			: (tasks.find((each) => each.task === conversation.task) ?? null);
	return need(task, conversation);
}
