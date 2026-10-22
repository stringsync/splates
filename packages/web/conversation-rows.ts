import type { ConversationState } from "@stringsync/splates-server/conversations";
import {
	answeredThrough,
	externals,
	type Need,
	type Needing,
	need,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { arriveAt } from "./arrivals";
import { NEW, openedBy } from "./conversation-address";
import { reportedAs, reportsDone, waitsOn } from "./conversation-names";
import { isPartOf, type Nested, nest } from "./parts";
import { unanswered } from "./unanswered";

/**
 * The rows of the sidebar and the phone's inbox, persistent agents' first,
 * then the pinned ones, each
 * newest first: the conversations listed, then external agents' tasks, which
 * no list shows (see `shownIn`), but whose work and waits count for the
 * conversations they answer to.
 * `listed` picks the conversations, by default those not archived, and
 * each persistent agent's placeholder (see `placeholders`).
 */
export function rowsOf(
	tasks: Details[],
	conversations: ConversationState[],
	listed: (conversation: ConversationState) => boolean = defaultListed(
		conversations,
	),
): Needing[] {
	const rows = conversations.filter(listed).map((conversation) => ({
		conversation,
		task: null,
		need: needOf(tasks, conversation),
	}));
	// Together, so an external agent's wait lifts onto the conversation it
	// answers to.
	return answeredThrough(
		[...rows, ...externals(tasks, conversations)],
		conversations,
	).toSorted(
		(one, other) =>
			Number(kept(other)) - Number(kept(one)) ||
			Number(pinned(other)) - Number(pinned(one)) ||
			started(other).localeCompare(started(one)),
	);
}

/**
 * `trees` as a list shows them: no external agent's task, which only the
 * Tasks page lists, any agents it handed out in its place, and none of those
 * agents once it has exited, unless it still waits on you or hosts one that
 * is shown. The widgets still show them.
 */
export function shownIn(
	trees: Nested<Needing>[],
	nested = false,
): Nested<Needing>[] {
	return trees.flatMap((tree) => {
		if (tree.row.conversation === null) {
			return shownIn(tree.parts, nested);
		}
		const parts = shownIn(tree.parts, true);
		return nested && exited(tree.row) && parts.length === 0
			? []
			: [{ row: tree.row, parts }];
	});
}

/** Whether a row's agent has exited and asks nothing of you. */
function exited(row: Needing): boolean {
	return row.conversation?.status === "stopped" && row.need.kind !== "waiting";
}

/** Those not archived, and each persistent agent's placeholder. */
function defaultListed(
	conversations: ConversationState[],
): (conversation: ConversationState) => boolean {
	const holding = placeholders(conversations);
	return (each) => !each.archived || holding.has(each);
}

/**
 * The run that holds each persistent agent's row while none of its runs is
 * open: the newest of its role, archived resting as its run ended, shown
 * faint in its place, so the row neither comes nor goes between runs.
 */
export function placeholders(
	conversations: ConversationState[],
): Set<ConversationState> {
	const newest = new Map<string, ConversationState>();
	const open = new Set<string>();
	for (const each of conversations) {
		const role = each.persistent;
		if (role === undefined) {
			continue;
		}
		if (!each.archived) {
			open.add(role);
		}
		const kept = newest.get(role);
		if (kept === undefined || each.createdAt > kept.createdAt) {
			newest.set(role, each);
		}
	}
	return new Set(
		[...newest].flatMap(([role, each]) =>
			!open.has(role) && each.archived && each.resting === true ? [each] : [],
		),
	);
}

/** Whether `conversation` holds its persistent agent's row as a placeholder. */
export function placeholding(conversation: ConversationState): boolean {
	return (
		conversation.persistent !== undefined &&
		conversation.archived &&
		conversation.resting === true
	);
}

/** Whether a row's conversation is a persistent agent's, as the groomer's. */
function kept(row: Needing): boolean {
	return row.conversation?.persistent !== undefined;
}

/** Whether a row's conversation is pinned atop the list. */
function pinned(row: Needing): boolean {
	return row.conversation?.pinned === true;
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

/**
 * The next of `rows` after the one `open` shows, around to the top, that
 * waits on you, or with none waiting, the next merged or finished one, then the next
 * unread one: what ⌥⌘M opens, and archiving goes on to. Of each, one at work
 * on the same lane as the one open comes first, as `taken` names each task's
 * lane, so the lane's work is seen together. The one open is
 * passed over, so ⌥⌘M on a task asking questions moves on, and comes back to its
 * questions only when nothing else is left.
 */
export function nextWaiting(
	rows: Needing[],
	open: string | null,
	taken: Readonly<Record<string, number>>,
): Needing | undefined {
	const waits = waitsOnYou;
	const at = rows.findIndex((row) => openedBy(row) === open);
	const others = [...rows.slice(at + 1), ...rows.slice(0, at + 1)].filter(
		(row) => openedBy(row) !== open,
	);
	const lane = laneOf(rows[at], taken);
	const lanemates = others.filter(
		(row) => lane !== undefined && laneOf(row, taken) === lane,
	);
	const first = (is: (row: Needing) => boolean) =>
		lanemates.find(is) ?? others.find(is);
	return (
		first(waits) ??
		first(wasMerged) ??
		first(isUnread) ??
		rows.find((row) => openedBy(row) === open && waits(row))
	);
}

/** The lane `row`'s conversation is at work on, as `taken` names it. */
function laneOf(
	row: Needing | undefined,
	taken: Readonly<Record<string, number>>,
): number | undefined {
	const task = row?.conversation?.task ?? null;
	return task === null ? undefined : taken[task];
}

/**
 * Once the conversation `open` shows is archived, on to what ⌥⌘M would open,
 * or a new conversation with none.
 */
export function goOn(
	rows: Needing[],
	open: string | null,
	taken: Readonly<Record<string, number>>,
	onOpen: (id: string) => void,
): void {
	const next = nextWaiting(rows, open, taken);
	if (next === undefined || openedBy(next) === open) {
		onOpen(NEW);
	} else {
		arriveAt(openedBy(next));
		onOpen(openedBy(next));
	}
}

/** Whether `row` shows as merged, or its lanes finished, in the sidebar. */
function wasMerged({ conversation, need }: Needing): boolean {
	return (
		conversation !== null &&
		reportsDone(conversation) &&
		(need.kind === "idle" ||
			(need.kind === "waiting" && need.why !== "ask" && need.why !== "failed"))
	);
}

/** Whether `row` shows as unread in the sidebar. */
function isUnread({ conversation, need }: Needing): boolean {
	return (
		conversation?.unread === true &&
		need.kind === "idle" &&
		!waitsOn(reportedAs(conversation))
	);
}

/**
 * Whether ⌥⌘M, Needs you and the waiting counts stop on `row`: a
 * conversation stopped on you, while it has questions no reply has answered
 * yet. An agent outside the page never does, as it asks in its own session.
 */
export function waitsOnYou({ conversation, need }: Needing): boolean {
	// One the page runs asks as it works only in its plan, until its report
	// asks again as it stops. A subagent of one here waits through that one.
	if (conversation === null) {
		return false;
	}
	if (need.kind === "waiting" && need.why !== "questions") {
		return true;
	}
	if (
		need.kind === "idle" ||
		need.kind === "working" ||
		need.kind === "assuming"
	) {
		return false;
	}
	return unanswered(need.questions, conversation.messages).length > 0;
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
 * Whether `part` nests under `host`: the person nested it there, or, until
 * they nest it anywhere, its task is a part of host's, or host's agent added
 * it, as when it handed a subagent a task that lands on trunk.
 */
export function isHostOf(
	tasks: Details[],
	host: Needing,
	part: Needing,
): boolean {
	const placed = part.conversation?.parent ?? null;
	if (placed !== null) {
		return placed.id !== null && placed.id === host.conversation?.id;
	}
	const caller = callerOfRow(tasks, part);
	return (
		isPartOf(baseOfRow(tasks, part), lastTaskOfRow(host)) ||
		(caller !== null &&
			caller === host.conversation?.id &&
			caller !== part.conversation?.id)
	);
}

/**
 * The conversations with a subagent at work under them: a row nested under
 * one, however deep, whose agent is working, as on a part it handed out.
 */
export function hostingWork(
	tasks: Details[],
	conversations: ConversationState[],
): Set<string> {
	return hostsAtWork(nestRows(tasks, rowsOf(tasks, conversations)));
}

/** What `hostingWork` reads, from the rows already nested. */
export function hostsAtWork(trees: Nested<Needing>[]): Set<string> {
	const hosting = new Set<string>();
	const atWork = ({ row, parts }: Nested<Needing>): boolean => {
		const working = parts.map(atWork).some(Boolean);
		if (working && row.conversation !== null) {
			hosting.add(row.conversation.id);
		}
		return (
			working || row.need.kind === "working" || row.need.kind === "assuming"
		);
	};
	trees.forEach(atWork);
	return hosting;
}

/** A row's key: its conversation's id, or its external agent's task. */
export function keyOfRow(row: Needing): string {
	return row.conversation?.id ?? `external ${row.task?.task ?? ""}`;
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

/** Nests conversation rows under their explicit parent, task host, or caller. */
export function nestRows(tasks: Details[], rows: Needing[]): Nested<Needing>[] {
	const byTask = new Map(tasks.map((task) => [task.task, task]));
	const byId = new Map<string, Needing[]>();
	const byBase = new Map<string, Needing[]>();
	const order = new Map(rows.map((row, at) => [row, at]));
	for (const row of rows) {
		if (row.conversation !== null) {
			const id = row.conversation.id;
			byId.set(id, [...(byId.get(id) ?? []), row]);
		}
		const task = lastTaskOfRow(row);
		if (task !== null) {
			const base = `task/${task}`;
			byBase.set(base, [...(byBase.get(base) ?? []), row]);
		}
	}
	const hosts = new Map<Needing, Needing>();
	for (const row of rows) {
		const placed = row.conversation?.parent ?? null;
		const task = byTask.get(lastTaskOfRow(row) ?? "");
		const base = row.conversation?.lastBase ?? task?.base ?? null;
		const caller = row.conversation?.lastCaller ?? task?.caller ?? null;
		const candidates =
			placed !== null
				? placed.id === null
					? []
					: (byId.get(placed.id) ?? [])
				: [
						...(base === null ? [] : (byBase.get(base) ?? [])),
						...(caller === null || caller === row.conversation?.id
							? []
							: (byId.get(caller) ?? [])),
					];
		const host = candidates
			.filter((each) => each !== row)
			.sort((one, other) => (order.get(one) ?? 0) - (order.get(other) ?? 0))[0];
		if (host !== undefined) {
			hosts.set(row, host);
		}
	}
	return nest(rows, (host, part) => hosts.get(part) === host);
}
