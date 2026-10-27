import type { GoneBlocker, TaskRecord } from "./task";

/**
 * Why a task's work was set aside and what it waits on, as the agent that
 * deferred it said: read it to tell the person what stopped the work, and
 * to start it again from there. Pass it with the board to
 * `deferralBlockers` for where each blocker stands now.
 */
export interface Deferral {
	/** What the agent found that stops the work, in a sentence or two. */
	why: string;
	/** When it was deferred. */
	at: string;
	/** The started task deferred, whose worktree went. */
	task: string;
	/** The `splates server` conversation it was deferred from; absent for none known. */
	conversation?: string;
	/** The tasks it waits on to merge, with their subjects when it was deferred. */
	tasks: GoneBlocker[];
	/** Questions for the person, each in the skill's question format. */
	questions: DeferredQuestion[];
	/** What it waits on outside splates: a key, an upstream release. */
	outside: OutsideBlocker[];
}

export interface DeferredQuestion {
	text: string;
	/** The person's answer; absent while it is open. */
	answer?: string;
}

export interface OutsideBlocker {
	what: string;
	/** Set once the person marks it done. */
	done?: true;
}

/** What a deferral names, before it is recorded. */
export interface DeferralAsk {
	why: string;
	blockedBy: number[];
	questions: string[];
	outside: string[];
}

/** Where one blocker a deferral named stands now. */
export type DeferralBlocker =
	| {
			kind: "task";
			id: number;
			subject: string;
			status: TaskBlockerStatus;
	  }
	| { kind: "question"; text: string; status: "open" | "answered" }
	| { kind: "outside"; what: string; status: "open" | "done" };

/**
 * A task blocker's stage on the board, `working` once taken; `merged` once
 * it landed; `removed` once it left the board without merging; `unlinked`
 * when the person let the deferred task stop waiting on it.
 */
export type TaskBlockerStatus =
	| "backlog"
	| "ready"
	| "queued"
	| "working"
	| "merged"
	| "removed"
	| "unlinked";

/** Whether a blocker no longer holds the work back. */
export function cleared(blocker: DeferralBlocker): boolean {
	return !["backlog", "ready", "queued", "working", "open"].includes(
		blocker.status,
	);
}

/**
 * Each blocker `task`'s deferral named, with where it stands now among the
 * tasks on the board, `board`; empty for a task never deferred.
 */
export function deferralBlockers(
	task: TaskRecord,
	board: readonly TaskRecord[],
): DeferralBlocker[] {
	const deferred = task.deferred;
	if (deferred === undefined) {
		return [];
	}
	const landed = new Set((task.blockersLanded ?? []).map(({ id }) => id));
	const taskStatus = (id: number): TaskBlockerStatus => {
		if (landed.has(id)) {
			return "merged";
		}
		const other = board.find((each) => each.id === id);
		if (other === undefined) {
			return "removed";
		}
		if (!task.blockedBy.includes(id)) {
			return "unlinked";
		}
		return other.takenBy !== null || other.stage === "running"
			? "working"
			: other.stage;
	};
	return [
		...deferred.tasks.map(
			({ id, subject }): DeferralBlocker => ({
				kind: "task",
				id,
				subject,
				status: taskStatus(id),
			}),
		),
		...deferred.questions.map(
			({ text, answer }): DeferralBlocker => ({
				kind: "question",
				text,
				status: answer === undefined ? "open" : "answered",
			}),
		),
		...deferred.outside.map(
			({ what, done }): DeferralBlocker => ({
				kind: "outside",
				what,
				status: done ? "done" : "open",
			}),
		),
	];
}

/**
 * Refuses a deferral that says no why or names no blocker, saying how to
 * name each, so the agent learns it at the moment it defers.
 */
export function deferralProblem(ask: Partial<DeferralAsk>): string | null {
	const missing: string[] = [];
	if ((ask.why ?? "").trim() === "") {
		missing.push(
			'say why it stopped with --why "<what you found that stops the work, in a sentence or two>"',
		);
	}
	const named =
		(ask.blockedBy ?? []).length +
		(ask.questions ?? []).filter((each) => each.trim() !== "").length +
		(ask.outside ?? []).filter((each) => each.trim() !== "").length;
	if (named === 0) {
		missing.push(
			"name at least one blocker: --blocked-by <task number> for a task that has to merge first (`splates task add` it when there is none yet); " +
				'--ask "<question>" for a call only the person can make, in the question format the skill uses (the question ending at its `?`, the why on the next line indented, any `- (a)` choices under it); ' +
				'--waiting-on "<what>" for something outside splates, such as a key or an upstream release',
		);
	}
	if (missing.length === 0) {
		return null;
	}
	return `a deferral (--reason blocked) has to ${missing.join(", and ")}. Each flag may be repeated. Add --detail "<text>" to rewrite the task's detail for whoever takes it next: why it stopped, what you found, the steps done (\`- [x]\`) and left, and, since this discards the branch, what of it is worth redoing`;
}
