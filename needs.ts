import { Markdown } from "webappwiz/md";
import type { ConversationState } from "./conversations";
import { type Question, questions } from "./plan";
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
	  }
	| {
			kind: "assuming";
			/** The first open question. */
			subject: string;
			questions: Question[];
	  }
	| {
			kind: "working";
			/** The first unchecked step under `## Next`, when there is one. */
			subject: string | null;
	  }
	| { kind: "idle" };

/**
 * Why an agent waits: a live ACP ask (a permission or a form), a review it
 * escalated for, any other escalation, open questions it ended its turn on,
 * or a failure.
 */
export type Why = "ask" | "review" | "escalated" | "questions" | "failed";

/** One agent the page shows: a conversation, its task, or both. */
export interface Needing {
	conversation: ConversationState | null;
	task: Details | null;
	need: Need;
}

const KINDS: Need["kind"][] = ["waiting", "assuming", "working", "idle"];

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
	const listed = conversations.filter((each) => !each.archived);
	const live = tasks.filter((each) =>
		["working", "merging", "escalated"].includes(each.status),
	);
	const found: Needing[] = [
		...listed.map((conversation) => {
			const task = live.find((each) => each.task === conversation.task) ?? null;
			return { conversation, task, need: need(task, conversation) };
		}),
		// One handed to an agent shows once its conversation starts.
		...live
			.filter(
				(task) =>
					!task.dispatched && !listed.some((each) => each.task === task.task),
			)
			.map((task) => ({ conversation: null, task, need: need(task, null) })),
	];
	// Stable, so equals keep the order they came in.
	return found.sort(
		(one, other) =>
			KINDS.indexOf(one.need.kind) - KINDS.indexOf(other.need.kind) ||
			pressing(one.need, other.need),
	);
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
		? { kind: "working", subject: task?.plan ? nextStep(task.plan) : null }
		: { kind: "idle" };
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

const STEP = /^[ \t]*- \[ \][ \t]+(.+)$/m;

/** The first unchecked item under `## Next`, as written. */
function nextStep(plan: string): string | null {
	const md = Markdown.parse(plan);
	if (!md.has("Next")) {
		return null;
	}
	return STEP.exec(md.section("Next").body)?.[1]?.trim() ?? null;
}
