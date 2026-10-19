import type { Device, Entry } from "../conversations";
import type { Decision } from "../plans";
import type { Log, Storage } from "../storage";
import type { DiffSize, MergeFailure, RemoveReason } from "../tasks";
import type { Finding } from "./findings";
import { type TaskUsage, taskLog } from "./task-log";

/**
 * Every task that has ended on this machine, across projects, in
 * `~/.splates/outcomes.jsonl`, oldest first. Unlike the journal it is never
 * trimmed: a trend needs months of it, and a line per task stays small.
 */
export class Outcomes {
	readonly log: Log<Outcome>;
	/**
	 * Beside `log`, the usage of the turns tasks ended in, which `splates
	 * merge` writes its line too early to see. Apart from `log`, so splates
	 * versions that read only that never mistake one for a task.
	 */
	readonly turns: Log<TurnUsage>;

	constructor(
		/** The machine's storage, or a test's own. */
		storage: Storage,
	) {
		this.log = storage.log("outcomes.jsonl");
		this.turns = storage.log("outcome-usage.jsonl");
	}

	async record(outcome: Outcome): Promise<void> {
		// Appending, rather than rewriting, keeps two agents ending tasks at once
		// from dropping each other's line.
		await this.log.append(outcome);
	}

	async list(): Promise<Outcome[]> {
		const turns = await this.turns.replay();
		return (await this.log.replay()).map((outcome) =>
			known(
				turns
					.filter(
						(turn) =>
							turn.project === outcome.project &&
							turn.task === outcome.task &&
							turn.endedAt === outcome.endedAt,
					)
					.reduce(credited, outcome),
			),
		);
	}

	/**
	 * Credits the task that `conversation`, logged in `log`, ended last in
	 * its turn from `since` to `until` with what the rest of that turn used,
	 * once the turn has ended and said it. Several ended in one turn: the
	 * last one's is what the turn finished on.
	 */
	async creditTurn(
		conversation: string,
		log: Log<Entry>,
		since: string,
		until: string,
	): Promise<void> {
		const ended = (await this.log.replay()).findLast(
			(each) =>
				each.conversation === conversation &&
				each.usage !== undefined &&
				each.endedAt >= since &&
				each.endedAt <= until,
		);
		if (ended?.usage === undefined) {
			return;
		}
		const whole = await taskLog(log, ended.startedAt, until);
		if (whole?.usage === undefined) {
			return;
		}
		const usage = less(whole.usage, ended.usage);
		if (usage.input === 0 && usage.output === 0 && !usage.cost?.amount) {
			return;
		}
		const turn: TurnUsage = {
			project: ended.project,
			task: ended.task,
			endedAt: ended.endedAt,
			usage,
		};
		await this.turns.append(turn);
	}
}

/**
 * What the rest of the turn a task ended in used, a line of
 * `~/.splates/outcome-usage.jsonl`, naming its outcome by when it ended.
 */
export interface TurnUsage {
	project: string;
	task: string;
	endedAt: string;
	usage: TaskUsage;
}

/** `outcome` with `turn`'s usage added to its own. */
function credited(outcome: Outcome, turn: TurnUsage): Outcome {
	const usage = outcome.usage;
	if (usage === undefined) {
		return outcome;
	}
	return {
		...outcome,
		usage: {
			input: usage.input + turn.usage.input,
			cached: usage.cached + turn.usage.cached,
			output: usage.output + turn.usage.output,
			cost:
				usage.cost === null && turn.usage.cost === null
					? null
					: {
							amount:
								(usage.cost?.amount ?? 0) + (turn.usage.cost?.amount ?? 0),
							currency:
								usage.cost?.currency ?? turn.usage.cost?.currency ?? "USD",
						},
		},
	};
}

/** What `whole` used past `part`. */
function less(whole: TaskUsage, part: TaskUsage): TaskUsage {
	return {
		input: whole.input - part.input,
		cached: whole.cached - part.cached,
		output: whole.output - part.output,
		cost:
			whole.cost === null
				? null
				: {
						amount: whole.cost.amount - (part.cost?.amount ?? 0),
						currency: whole.cost.currency,
					},
	};
}

/**
 * `outcome` with no usage when it kept none worth reading: no agent turn
 * produced no tokens, so 0 out means the turn that did the work was never
 * counted, as for a task merged in the turn it began in.
 */
function known(outcome: Outcome): Outcome {
	if (outcome.usage === undefined || outcome.usage.output > 0) {
		return outcome;
	}
	const { usage: _, ...rest } = outcome;
	return rest;
}

/**
 * How one task ended, written as it goes. Its record goes with it, so this is
 * what is left to tell whether tasks are getting easier to land over time.
 */
export interface Outcome {
	/** The main tree of the repository the task was in. */
	project: string;
	task: string;
	/** Where it landed or would have: trunk, or `task/<parent>` for a part. */
	base: string;
	ended: "merged" | "removed";
	/** When it was added, as an ISO timestamp. */
	startedAt: string;
	/** When it was merged or removed, as an ISO timestamp. */
	endedAt: string;
	/** How many times it was handed to a person with questions. */
	questionRounds: number;
	/** How many times it was handed to a person to approve. */
	reviewRounds: number;
	/** Merges that failed on a conflict, the gate, or a base that would not move. */
	failedMerges: number;
	/** `failedMerges` by why each failed. Absent from lines written before it was kept. */
	failedMergesBy?: Partial<Record<MergeFailure, number>>;
	/** The questions its plan asked under `## Blocked`. Absent from older lines. */
	questionsAsked?: number;
	/** Of those, the ones that offered a `(chosen)` pick and were answered with a choice. */
	picksAsked?: number;
	/** Of `picksAsked`, those answered with another choice than the agent's. */
	picksOverturned?: number;
	/** Of `picksAsked`, those answered with the agent's choice but with words added. */
	picksAmended?: number;
	/**
	 * Each question its plan asked, with its size and what became of it. Absent from older lines, whose calls the counts above alone keep.
	 */
	decisions?: Decision[];
	/** How long it waited on a person to answer, in milliseconds. Absent from older lines. */
	waitedMs?: number;
	/** Why it was removed, when `splates remove --reason` said; null when merged or unsaid. */
	removedFor?: RemoveReason | null;
	/** For a merge, each commit's message it landed, oldest first. Absent from older lines. */
	commits?: string[];
	/**
	 * How many times the person spoke to its conversation from each layout of
	 * the page while it ran. Absent from older lines.
	 */
	promptsFrom?: Partial<Record<Device, number>>;
	/**
	 * What its own turns used, not the rest of its conversation's, the turn it
	 * ended in added from `turns` once `splates server` saw it end. Absent from
	 * older lines, for a task with no conversation log to read, and, as read,
	 * for one with no tokens out, which never kept the turns that did its work.
	 */
	usage?: TaskUsage;
	/** How long its agent worked, its turns summed, in milliseconds. Absent as `usage` is. */
	workedMs?: number;
	/**
	 * What made workers cost it until it ended, its slots' share of each
	 * worker's hours. Absent when it held no slot on one, and from older lines.
	 */
	workerSpend?: WorkerSpend;
	/** What it landed, or for a removed task, what its branch held. Absent from older lines. */
	size?: DiffSize;
	/** What went worse than it could have. Absent from older lines, never read as none. */
	findings?: Finding[];
	/** The `splates server` conversation that ended it; null for an external agent. */
	conversation: string | null;
	/** The agent `splates add --agent` handed it to, if any. */
	agent: string | null;
	/** The model it was handed over with, if any. */
	model: string | null;
}

/** What made workers cost one task. */
export interface WorkerSpend {
	dollars: number;
	/** Slot-hours its agents held on made workers. */
	slotHours: number;
	/** True when counted at the provider's list price, false when from its bill. */
	estimate: boolean;
}

/**
 * How many prompts the person said from each layout in the conversation
 * logged in `log`, from `since` to `until`: a conversation can outlive the
 * task, or come to it already under way.
 */
export async function promptsFrom(
	log: Log<Entry>,
	since: string,
	until: string,
): Promise<Partial<Record<Device, number>>> {
	const counts: Partial<Record<Device, number>> = {};
	for (const entry of await log.replay()) {
		if (
			entry.kind === "prompt" &&
			entry.from !== undefined &&
			entry.at !== undefined &&
			entry.at >= since &&
			entry.at <= until
		) {
			counts[entry.from] = (counts[entry.from] ?? 0) + 1;
		}
	}
	return counts;
}
