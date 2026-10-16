import { Markdown } from "webappwiz/md";
import { Duration } from "webappwiz/time";
import type { ConversationState } from "./conversations";
import { goalLine, type Question, questions, STUB_STEP } from "./plan";
import type { Details } from "./show";

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
			 * What to act on: the ask, what a review asks you to look at, the
			 * first open question, or the failure.
			 */
			subject: string;
			/** When it stopped, where that is known. */
			since: string | null;
			/** The task's open questions, none for a task-less conversation. */
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
	  }
	| { kind: "idle" };

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
}: {
	tasks: Details[];
	conversations: ConversationState[];
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
		...externals(tasks, conversations),
	];
	// Stable, so equals keep the order they came in.
	return answeredThrough(found, conversations).sort(
		(one, other) =>
			KINDS.indexOf(one.need.kind) - KINDS.indexOf(other.need.kind) ||
			pressing(one.need, other.need),
	);
}

/**
 * Why an agent waits: a live ACP ask (a permission or a form), a review it
 * escalated for, any other escalation, open questions it ended its turn on,
 * a failure, or for a task, no agent left on it (see `abandoned`).
 */
export type Why =
	| "ask"
	| "review"
	| "escalated"
	| "questions"
	| "failed"
	| "abandoned";

const KINDS: Need["kind"][] = ["waiting", "assuming", "working", "idle"];

/** Whether a task is under way, so an agent may yet need something for it. */
function isLive(task: Details): boolean {
	return ["working", "merging", "escalated"].includes(task.status);
}

/**
 * Every live task no listed conversation runs in, an external agent's, with
 * what it needs, before `answeredThrough`. One handed to an agent shows once
 * its conversation starts.
 */
export function externals(
	tasks: Details[],
	conversations: ConversationState[],
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
			need: needOfExternal(task, conversations),
		}));
}

/** What a task no listed conversation runs in needs: see `externals`. */
export function needOfExternal(
	task: Details,
	conversations: ConversationState[],
): Need {
	const left = abandoned(task, conversations);
	if (left === null) {
		return need(task, null);
	}
	const asked = need(task, null);
	return {
		kind: "waiting",
		why: "abandoned",
		subject: left.subject,
		since: left.since,
		questions: "questions" in asked ? asked.questions : [],
	};
}

/**
 * Whether no agent is left on an external task, for certain: the page
 * conversation whose agent last took it is archived, or gone with the oldest
 * archived ones, and no agent outside the page has taken it since. What it
 * says of it, and since when; null while an agent may yet be on it. A
 * conversation listed on another task may still have a subagent on this
 * one, so only going quiet tells of it.
 */
export function abandoned(
	task: Details,
	conversations: ConversationState[],
): { subject: string; since: string | null } | null {
	if (task.takenBy === null) {
		return null;
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
 * How long an external agent's task goes without a sign of it at work before
 * it shows as quiet: long enough for a test run or a long think.
 */
export const QUIET_AFTER = Duration.mins(30);

/**
 * When an external agent's task last showed a sign of its agent at work, once
 * that is `QUIET_AFTER` ago at `now`; null while it has lately, or nothing
 * says. Only an agent taken to be at work goes quiet: one that waits on the
 * person is still for a reason.
 */
export function quietSince(
	{ task, need }: Pick<Needing, "task" | "need">,
	now: number,
): string | null {
	const at = task?.activeAt ?? null;
	return at !== null &&
		(need.kind === "working" || need.kind === "assuming") &&
		now - Date.parse(at) >= QUIET_AFTER.ms
		? at
		: null;
}

/**
 * What one agent needs, from its conversation (null for an agent the page
 * does not run) and the task it is in (null for the main tree).
 */
export function need(
	task: Details | null,
	conversation: ConversationState | null,
): Need {
	const open = task?.plan
		? questions(task.plan).filter(
				(asked) => !asked.done && asked.reply === null,
			)
		: [];
	const waiting = (
		why: Why,
		subject: string,
		since: string | null = null,
	): Need => ({ kind: "waiting", why, subject, since, questions: open });

	const ask = conversation?.ask ?? null;
	if (ask !== null) {
		return waiting(
			"ask",
			ask.type === "permission" ? ask.title : ask.message,
			ask.at,
		);
	}
	// A reply starts the agent's turn before it claims the task back.
	const replied =
		conversation?.status === "running" || conversation?.status === "starting";
	if (task?.status === "escalated" && !replied) {
		if (task.review !== null) {
			return waiting("review", task.review, task.escalatedAt);
		}
		return waiting(
			"escalated",
			open[0]?.text ?? task.escalation ?? "Escalated",
			task.escalatedAt,
		);
	}
	if (conversation?.status === "failed") {
		return waiting("failed", conversation.error ?? "Failed");
	}
	// An agent the page does not run is taken to be at work on its task.
	const running =
		conversation === null ||
		conversation.status === "running" ||
		conversation.status === "starting";
	const [first] = open;
	if (first !== undefined) {
		return running
			? { kind: "assuming", subject: first.text, questions: open }
			: waiting("questions", first.text);
	}
	return running
		? { kind: "working", subject: task?.plan ? doing(task.plan) : null }
		: { kind: "idle" };
}

/**
 * `found` with each agent that answers to another conversation waiting on
 * that one rather than on the person: only the person answers its asks, so
 * one waits on that one's row, where they show, whatever it is doing; its
 * escalations reach the person through that one's reports, so one waits on
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
	// An ask before an escalation, as the agent is stuck mid-turn on it.
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
 * The conversation an agent answers to, rather than to the person, while the
 * page holds it: the one that handed its conversation the task, or for an
 * external agent, such as a subagent its harness started, the listed one
 * whose agent added its task.
 */
export function answersTo(
	{ conversation, task }: Pick<Needing, "conversation" | "task">,
	conversations: readonly ConversationState[],
): ConversationState | null {
	if (conversation !== null) {
		const by = conversation.handedBy;
		return by === null
			? null
			: (conversations.find((each) => each.id === by) ?? null);
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

/** The first unchecked item under `## Next`, as written, but for the stub's. */
function nextStep(plan: string): string | null {
	const md = Markdown.parse(plan);
	if (!md.has("Next")) {
		return null;
	}
	for (const [, step] of md.section("Next").body.matchAll(STEPS)) {
		if (step !== undefined && step.trim() !== STUB_STEP) {
			return step.trim();
		}
	}
	return null;
}
