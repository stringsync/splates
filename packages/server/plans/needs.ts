import { Markdown } from "webappwiz/md";
import { Duration } from "webappwiz/time";
import type { ConversationState } from "../conversations";
import type { Details } from "../tasks";
import { stretches } from "./asked";
import { goalLine, openQuestions, type Question, STUB_STEPS } from "./plan";

/** One agent the page shows: a conversation, its task, or both. */
export interface Needing {
	conversation: ConversationState | null;
	task: Details | null;
	need: Need;
}

/**
 * Every listed conversation, and every live task no listed conversation runs
 * in (an external agent, run outside the page) and none is about to, with
 * what each needs: those waiting first,
 * oldest stop first, then those assuming, most open questions first, then the
 * rest in the order given.
 */
export function needs({
	tasks,
	conversations,
	now = Date.now(),
}: {
	tasks: Details[];
	conversations: ConversationState[];
	/** What an external agent's quiet is measured to: see `ASKED_QUIET`. */
	now?: number;
}): Needing[] {
	const live = tasks.filter(isLive);
	const found: Needing[] = [
		...conversations
			.filter((each) => !each.archived)
			.map((conversation) => {
				const task =
					live.find((each) => each.task === conversation.task) ?? null;
				return { conversation, task, need: need(task, conversation) };
			}),
		...externals(tasks, conversations, now),
	];
	// Stable, so equals keep the order they came in.
	return answeredThrough(found, conversations).sort(
		(one, other) =>
			KINDS.indexOf(one.need.kind) - KINDS.indexOf(other.need.kind) ||
			pressing(one.need, other.need),
	);
}

/**
 * What an agent needs from the person, by how much it costs to leave it:
 * `waiting` has stopped on them, `assuming` goes ahead on a guess an answer
 * may overturn, `working` needs nothing yet, and `idle` is not doing anything.
 */
export type Need =
	| {
			kind: "waiting";
			why: Why;
			/**
			 * What to act on: the ask, the review's summary, the first open
			 * question, or the failure.
			 */
			subject: string;
			/** When it stopped, where that is known. */
			since: string | null;
			/**
			 * The task's open questions, else those the agent's last reply
			 * asks; none for other waits of a task-less conversation.
			 */
			questions: Question[];
			/** The agent handed out by this one it waits for, lifted onto it. */
			via?: string;
	  }
	| {
			kind: "assuming";
			/** The first open question. */
			subject: string;
			questions: Question[];
			/** The agent handed out by this one whose questions it relays. */
			via?: string;
	  }
	| {
			kind: "working";
			/** The next step under `## Next`, else the Goal's first line. */
			subject: string | null;
			/** Its task's merge: waiting its turn for the premerge lock, or testing and landing. */
			merge?: "queued" | "running";
			/** When that merge was asked for, its wait for the lock included. */
			mergeSince?: string;
	  }
	| { kind: "idle" };

/**
 * Why an agent waits: a live ACP ask (a permission or a form), a review its
 * last reply asked for, open questions it ended its turn on, in its task's
 * `## Blocked` or its last reply (or for an external agent, went quiet on), a failure, or for a task, no agent left on
 * it (see `orphaned`).
 */
export type Why = "ask" | "review" | "questions" | "failed" | "orphaned";

const KINDS: Need["kind"][] = ["waiting", "assuming", "working", "idle"];

/** Whether a task is under way, so an agent may yet need something for it. */
function isLive(task: Details): boolean {
	return ["working", "merging"].includes(task.status);
}

/**
 * Every live task no listed conversation runs in, an external agent's, with
 * what it needs, before `answeredThrough`. One handed to an agent shows once
 * its conversation starts.
 */
export function externals(
	tasks: Details[],
	conversations: ConversationState[],
	now: number = Date.now(),
): Needing[] {
	const listed = conversations.filter((each) => !each.archived);
	return tasks
		.filter(
			(task) =>
				isLive(task) &&
				!task.dispatched &&
				!listed.some((each) => each.task === task.task),
		)
		.map((task) => ({
			conversation: null,
			task,
			need: needOfExternal(task, conversations, now),
		}));
}

/** What a task no listed conversation runs in needs: see `externals`. */
export function needOfExternal(
	task: Details,
	conversations: ConversationState[],
	now: number = Date.now(),
): Need {
	const asked = need(task, null, now);
	const left = orphaned(task, conversations);
	if (left === null) {
		return asked;
	}
	return {
		kind: "waiting",
		why: "orphaned",
		subject: left.subject,
		since: left.since,
		questions: "questions" in asked ? asked.questions : [],
	};
}

/**
 * Whether no agent the page runs is left on a live task: none is on it,
 * the one whose agent last took it is archived or gone, or every one on it
 * failed. What it says of it, and since when; null while an agent may yet
 * be on it: one on it that has not failed, an agent outside the page holding
 * its lease now, or one a listed conversation started, which answers to it
 * (see `answersTo`). A conversation listed on another task may have a
 * subagent on this one, so it is not orphaned either.
 */
export function orphaned(
	task: Details,
	conversations: readonly ConversationState[],
): { subject: string; since: string | null } | null {
	if (!isLive(task) || task.dispatched || task.lease === "held") {
		return null;
	}
	const listed = conversations.filter((each) => !each.archived);
	const on = listed.filter((each) => each.task === task.task);
	if (on.length > 0) {
		return on.every((each) => each.status === "failed")
			? { subject: "Its agent failed", since: task.activeAt }
			: null;
	}
	if (answersTo({ conversation: null, task }, conversations) !== null) {
		return null;
	}
	if (task.takenBy === null) {
		return {
			subject: "No conversation here is on it",
			since: task.activeAt,
		};
	}
	const by = conversations.find((each) => each.id === task.takenBy);
	if (by === undefined) {
		return { subject: "Its conversation is gone", since: task.activeAt };
	}
	return by.archived
		? { subject: "Its conversation was archived", since: task.activeAt }
		: null;
}

/**
 * How long an external agent goes without a sign of work on its task, with
 * questions open, before it is taken to wait on their answers: it has ended
 * its turn on them, as a page conversation shows outright.
 */
export const ASKED_QUIET = Duration.mins(3);

/** What an agent at work on `task` needs: nothing yet, while merging or not. */
function working(task: Details | null): Need {
	const subject = task?.plan ? doing(task.plan) : null;
	const since = task?.mergeSince ? { mergeSince: task.mergeSince } : {};
	if (task?.status === "merging" || task?.gate === "running") {
		return { kind: "working", subject, merge: "running", ...since };
	}
	return task?.gate === "queued"
		? { kind: "working", subject, merge: "queued", ...since }
		: { kind: "working", subject };
}

/**
 * What one agent needs, from its conversation (null for an agent the page
 * does not run) and the task it is in (null for the main tree), at `now`.
 */
export function need(
	task: Details | null,
	conversation: ConversationState | null,
	now: number = Date.now(),
): Need {
	const open = task?.plan ? openQuestions(task.plan) : [];
	const waiting = (
		why: Why,
		subject: string,
		since: string | null = null,
		questions: Question[] = open,
	): Need => ({ kind: "waiting", why, subject, since, questions });

	const ask = conversation?.ask ?? null;
	if (ask !== null) {
		return waiting(
			"ask",
			ask.type === "permission" ? ask.title : ask.message,
			ask.at,
		);
	}
	if (conversation?.status === "failed") {
		return waiting("failed", conversation.error ?? "Failed");
	}
	const [first] = open;
	if (conversation === null) {
		// An agent the page does not run is taken to be at work on its task,
		// until it goes quiet with questions open.
		const at = task?.activeAt ?? null;
		if (
			first !== undefined &&
			at !== null &&
			now - Date.parse(at) >= ASKED_QUIET.ms
		) {
			return waiting("questions", first.text, at);
		}
		return first !== undefined
			? { kind: "assuming", subject: first.text, questions: open }
			: working(task);
	}
	const running =
		conversation.status === "running" || conversation.status === "starting";
	if (running) {
		return first !== undefined
			? { kind: "assuming", subject: first.text, questions: open }
			: working(task);
	}
	const last = conversation.messages.at(-1);
	const ended = last?.until ?? last?.at ?? null;
	if (first !== undefined) {
		return waiting("questions", first.text, ended);
	}
	const asked = askedIn(conversation);
	const [lead] = asked;
	if (lead !== undefined) {
		return waiting("questions", lead.text, ended, asked);
	}
	const review = reviewIn(conversation);
	return review !== null ? waiting("review", review, ended) : { kind: "idle" };
}

/**
 * The questions the agent's last reply asks, when that reply is its last
 * word, so none is answered yet, with or without a task behind them.
 */
function askedIn(conversation: ConversationState): Question[] {
	return stretches(lastWords(conversation) ?? "").flatMap((stretch) =>
		stretch.type === "questions" ? stretch.questions : [],
	);
}

/**
 * The summary of the review the agent's last reply asks for, when that
 * reply is its last word and holds one; null otherwise.
 */
function reviewIn(conversation: ConversationState): string | null {
	for (const stretch of stretches(lastWords(conversation) ?? "")) {
		if (stretch.type === "review") {
			return stretch.review.summary || "Ready to merge";
		}
	}
	return null;
}

/** The text of the conversation's last message, when the agent sent it. */
function lastWords(conversation: ConversationState): string | null {
	const last = conversation.messages.at(-1);
	if (last?.role !== "agent") {
		return null;
	}
	return last.parts
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n\n");
}

/**
 * `found` with each agent that answers to another conversation waiting on
 * that one rather than on the person: only the person answers its asks, so
 * one waits on that one's row, where they show, whatever it is doing; its
 * questions reach the person through that one's reports, so one waits on
 * that one's row once it is idle, having relayed it, naming the agent, and
 * while it works on regardless, that one goes ahead with them owed, as an
 * assuming agent does. A failure stays the agent's own, since nothing tells
 * that one of it.
 */
export function answeredThrough(
	found: Needing[],
	conversations: ConversationState[],
): Needing[] {
	const handedOut = (entry: Needing): string | null =>
		answersTo(entry, conversations)?.id ?? null;
	const relayed = (entry: Needing): boolean =>
		handedOut(entry) !== null &&
		entry.need.kind === "waiting" &&
		entry.need.why !== "failed";
	// An ask before any other wait, as the agent is stuck mid-turn on it.
	const lifted = new Map<string, Need>();
	for (const entry of found
		.filter(relayed)
		.toSorted(
			(one, other) =>
				Number(other.need.kind === "waiting" && other.need.why === "ask") -
				Number(one.need.kind === "waiting" && one.need.why === "ask"),
		)) {
		const by = handedOut(entry) as string;
		const via =
			entry.task?.task ?? entry.conversation?.task ?? entry.conversation?.title;
		if (!lifted.has(by) && entry.need.kind === "waiting") {
			lifted.set(by, via == null ? entry.need : { ...entry.need, via: via });
		}
	}
	return found.map((entry) => {
		if (relayed(entry)) {
			const running =
				entry.conversation?.status === "running" ||
				entry.conversation?.status === "starting";
			const plan = entry.task?.plan;
			return {
				...entry,
				need: running
					? { kind: "working", subject: plan ? doing(plan) : null }
					: { kind: "idle" },
			};
		}
		const wait = lifted.get(entry.conversation?.id ?? "");
		const takes =
			wait?.kind === "waiting" &&
			(wait.why === "ask"
				? entry.need.kind !== "waiting"
				: entry.need.kind === "idle");
		if (wait !== undefined && takes) {
			return { ...entry, need: wait };
		}
		if (
			wait?.kind === "waiting" &&
			wait.why !== "ask" &&
			entry.need.kind === "working"
		) {
			const { subject, questions, via } = wait;
			return {
				...entry,
				need: {
					kind: "assuming",
					subject,
					questions,
					...(via === undefined ? {} : { via }),
				},
			};
		}
		return entry;
	});
}

/**
 * The conversation an external agent, such as a subagent its harness
 * started, answers to rather than the person, while the page holds it: the
 * listed one whose agent added its task. A conversation of its own answers
 * to the person.
 */
export function answersTo(
	{ conversation, task }: Pick<Needing, "conversation" | "task">,
	conversations: readonly ConversationState[],
): ConversationState | null {
	if (conversation !== null) {
		return null;
	}
	const caller = task?.caller ?? null;
	return caller === null
		? null
		: (conversations.find((each) => each.id === caller && !each.archived) ??
				null);
}

/** Negative when `one` should come before `other` among needs of a kind. */
function pressing(one: Need, other: Need): number {
	if (one.kind === "waiting" && other.kind === "waiting") {
		// Unknown stops go last: a known one has provably waited.
		const at = (need: typeof one) =>
			need.since === null ? Number.POSITIVE_INFINITY : Date.parse(need.since);
		return at(one) - at(other) || 0;
	}
	if (one.kind === "assuming" && other.kind === "assuming") {
		return other.questions.length - one.questions.length;
	}
	return 0;
}

const STEPS = /^[ \t]*- \[ \][ \t]+(.+)$/gm;

/** What a task works on: its next step, or until it has one, its Goal. */
function doing(plan: string): string | null {
	return nextStep(plan) ?? goalLine(plan);
}

/** The first unchecked item under `## Next`, as written, but for a stub's. */
function nextStep(plan: string): string | null {
	const md = Markdown.parse(plan);
	if (!md.has("Next")) {
		return null;
	}
	for (const [, step] of md.section("Next").body.matchAll(STEPS)) {
		const trimmed = step?.trim();
		if (trimmed !== undefined && !STUB_STEPS.includes(trimmed)) {
			return trimmed;
		}
	}
	return null;
}

/** What `#conversations/task/<name>` opens: a task whose agent runs outside the page. */
export const TASK = "task/";

/** What opens `row`: its conversation's id, or its external agent's task. */
export function openedBy(row: Needing): string {
	return row.conversation?.id ?? `${TASK}${row.task?.task ?? ""}`;
}
