import type { Autopicked } from "../autopick/record";
import type {
	AutopickSet,
	Device,
	Entry,
	LiftReason,
	Pairing,
} from "../conversations";
import type { Decision } from "../plans";
import { Prices } from "../prices";
import type { Event } from "../records";
import type { Log, Storage } from "../storage";
import type {
	DiffSize,
	MergeFailure,
	MergeTimes,
	RemoveReason,
} from "../tasks";
import type { Finding } from "./findings";
import { type TaskLog, type TaskUsage, taskLog } from "./task-log";

/**
 * History of merged and removed tasks on this machine, across projects.
 * `list()` returns outcomes oldest first, with available usage, merge
 * timings, and batch membership.
 */
export class Outcomes {
	readonly log: Log<Outcome>;
	/**
	 * Usage adjustments for finished tasks, including usage from the rest
	 * of the turn that ended a task. `list()` includes these in its totals.
	 */
	// Apart from `log`, so splates versions that read only that never mistake
	// one for a task.
	readonly turns: Log<TurnUsage>;
	/**
	 * Recovered merge timings and batch membership. `list()` uses these
	 * when the outcome lacks the corresponding values.
	 */
	readonly merges: Log<MergeTimed>;
	/** The API list prices that agents saying no cost of their own are priced at. */
	readonly prices: Prices;

	constructor(
		/** The machine's storage, or a test's own. */
		storage: Storage,
		prices: Prices = new Prices(storage),
	) {
		// Keep the compact outcome history indefinitely for long-term trends.
		this.log = storage.log("outcomes.jsonl");
		this.turns = storage.log("outcome-usage.jsonl");
		this.merges = storage.log("outcome-merges.jsonl");
		this.prices = prices;
	}

	async record(outcome: Outcome): Promise<void> {
		// Appending, rather than rewriting, keeps two agents ending tasks at once
		// from dropping each other's line.
		await this.log.append(outcome);
	}

	async list(): Promise<Outcome[]> {
		// Add all matching usage adjustments and use the latest merge supplement.
		const turns = await this.turns.replay();
		const merges = await this.merges.replay();
		return (await this.log.replay()).map((outcome) => {
			const saved = merges.findLast((each) => sameOutcome(each, outcome));
			const merge = outcome.merge ?? saved?.merge;
			const batch = outcome.batch ?? saved?.batch;
			return known(
				turns
					.filter((turn) => sameOutcome(turn, outcome))
					.reduce(credited, {
						...outcome,
						...(merge === undefined ? {} : { merge }),
						...(batch === undefined ? {} : { batch }),
					}),
			);
		});
	}

	/**
	 * Recovers missing timings and batch membership for merged tasks.
	 * Outcomes without a matching timed merge stay as they are. Repeated
	 * runs skip fields that have already been recovered.
	 */
	async backfillMerges(
		eventsOf: (project: string) => Promise<Event[]>,
	): Promise<void> {
		const missing = (await this.list()).filter(
			(outcome) =>
				outcome.ended === "merged" &&
				(outcome.merge === undefined || outcome.batch === undefined),
		);
		const projects = new Map<string, Event[]>();
		for (const outcome of missing) {
			// Read each project's journal once during a backfill.
			let events = projects.get(outcome.project);
			if (events === undefined) {
				events = await eventsOf(outcome.project);
				projects.set(outcome.project, events);
			}
			const event = landedBy(events, outcome);
			if (
				event === undefined ||
				(outcome.merge !== undefined && event.batch === undefined) ||
				event.durationMs === undefined ||
				event.capacityWaitMs === undefined
			) {
				continue;
			}
			// The merge event follows worktree cleanup, so its run time includes it.
			await this.merges.append({
				project: outcome.project,
				task: outcome.task,
				endedAt: outcome.endedAt,
				...(event.batch === undefined ? {} : { batch: event.batch }),
				merge: outcome.merge ?? {
					queuedMs: event.capacityWaitMs,
					ranMs: Math.max(0, event.durationMs - event.capacityWaitMs),
				},
			});
		}
	}

	/**
	 * Fills in missing costs at API list prices for usage through the end
	 * of each task. Skips tasks whose usage is unavailable, whose conversation
	 * history is missing, or whose usage cannot be priced. Repeated runs
	 * skip tasks that already have a cost.
	 */
	async backfill(
		logOf: (project: string, conversation: string) => Promise<Log<Entry>>,
	): Promise<void> {
		const catalog = () => this.prices.catalog();
		for (const outcome of await this.list()) {
			if (
				outcome.conversation === null ||
				outcome.usage === undefined ||
				outcome.usage.cost !== null
			) {
				continue;
			}
			const log = await logOf(outcome.project, outcome.conversation);
			if (!(await log.exists())) {
				continue;
			}
			const whole = await taskLog(log, outcome.startedAt, outcome.endedAt, {
				catalog,
			});
			const cost = whole?.usage?.cost;
			if (cost === undefined || cost === null) {
				continue;
			}
			// Store the cost as an adjustment without counting the tokens twice.
			await this.turns.append({
				project: outcome.project,
				task: outcome.task,
				endedAt: outcome.endedAt,
				usage: { input: 0, cached: 0, output: 0, cost },
			});
		}
	}

	/** `creditTurn` once `conversation`'s log has taken the whole turn. */
	async creditSaved(
		conversation: { id: string; saved(): Promise<unknown> },
		log: Log<Entry>,
		since: string,
		until: string,
	): Promise<void> {
		// The outcome is written before the turn ends. Wait for the conversation
		// log to catch up so the rest of that turn can be credited.
		await conversation.saved();
		await this.creditTurn(conversation.id, log, since, until);
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
		const whole = await taskLog(log, ended.startedAt, until, {
			catalog: () => this.prices.catalog(),
		});
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

/**
 * The merge times of an outcome that landed before outcomes kept them, a
 * line of `~/.splates/outcome-merges.jsonl`, naming its outcome by when it
 * ended.
 */
export interface MergeTimed {
	/** Batch membership recovered from the successful merge event. */
	batch?: string[];
	project: string;
	task: string;
	endedAt: string;
	merge: MergeTimes;
}

/** Whether `line`, written beside the outcomes, belongs to `outcome`. */
function sameOutcome(
	line: { project: string; task: string; endedAt: string },
	outcome: Outcome,
): boolean {
	return (
		line.project === outcome.project &&
		line.task === outcome.task &&
		line.endedAt === outcome.endedAt
	);
}

/** How long after a task's outcome the `merge` event that landed it may come. */
const LANDED_WITHIN_MS = 10 * 60 * 1000;

/**
 * The successful `merge` event of `events` that landed `outcome`: the first
 * for its task and base once it ended, which `splates merge` logs as it
 * returns, after writing the outcome.
 */
function landedBy(
	events: Event[],
	outcome: Outcome,
): Extract<Event, { action: "merge" }> | undefined {
	const ended = Date.parse(outcome.endedAt);
	return events.find(
		(event): event is Extract<Event, { action: "merge" }> =>
			event.action === "merge" &&
			event.reason === null &&
			event.task === outcome.task &&
			event.base === outcome.base &&
			Date.parse(event.at) >= ended &&
			Date.parse(event.at) - ended <= LANDED_WITHIN_MS,
	);
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
							...(usage.cost?.listPrice || turn.usage.cost?.listPrice
								? { listPrice: true }
								: {}),
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
						...whole.cost,
						amount: whole.cost.amount - (part.cost?.amount ?? 0),
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
	/** The tasks sharing its successful landing gate, leader first; absent on solo and older merges. */
	batch?: string[];
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
	/** Counts of failed merge attempts by reason, when a breakdown is available. */
	failedMergesBy?: Partial<Record<MergeFailure, number>>;
	/**
	 * Number of merge conflicts involving each file, by path. An absent
	 * value can mean there were no conflicts or file counts are unavailable.
	 */
	conflictedFiles?: Record<string, number>;
	/** The questions its plan asked under `## Blocked`. Absent from older lines. */
	questionsAsked?: number;
	/** Of those, the ones that offered a `(chosen)` pick and were answered with a choice. */
	picksAsked?: number;
	/** Of `picksAsked`, those answered with another choice than the agent's. */
	picksOverturned?: number;
	/** Of `picksAsked`, those answered with the agent's choice but with words added. */
	picksAmended?: number;
	/**
	 * Each time the person set the model or effort of a conversation Autopick
	 * started, with the pick it overrode. Absent from older lines, and for a
	 * task Autopick did not start.
	 */
	overrides?: PickOverride[];
	/**
	 * The Autopick decision, including picks the person later overrode.
	 * An absent value leaves the pick unknown because older outcomes may omit it.
	 */
	autoPick?: OutcomeAutopick;
	/**
	 * Each question its plan asked, with its size and what became of it. Absent from older lines, whose calls the counts above alone keep.
	 */
	decisions?: Decision[];
	/**
	 * The `## Outcome` its plan ended on, as markdown: a summary of what
	 * changed and any pivot from the goal, a demo to trigger and its
	 * verification. Absent from older lines and for a plan with none.
	 */
	outcome?: string;
	/** How long it waited on a person to answer, in milliseconds. Absent from older lines. */
	waitedMs?: number;
	/** Why it was removed, when `splates remove --reason` said; null when merged or unsaid. */
	removedFor?: RemoveReason | null;
	/**
	 * The board of the lane it was queued in, as called when it ended; null
	 * for one never queued in a lane. Absent from older lines.
	 */
	board?: { id: number; name: string } | null;
	/** For a merge, each commit's message it landed, oldest first. Absent from older lines. */
	commits?: string[];
	/**
	 * How many times the person spoke to its conversation from each layout of
	 * the page while it ran. Absent from older lines.
	 */
	promptsFrom?: Partial<Record<Device, number>>;
	/**
	 * Tokens and cost attributable to this task's turns. Totals from
	 * `Outcomes.list()` include any later credit for the turn that ended it.
	 * Usage can be absent on older outcomes or when conversation history is
	 * unavailable. `Outcomes.list()` omits usage with zero output tokens.
	 */
	usage?: TaskUsage;
	/** How long its agent worked, its turns summed, in milliseconds. Absent as `usage` is. */
	workedMs?: number;
	/** How many agent turns it took, the one it ended in among them. Absent as `usage` is, and from older lines. */
	turns?: number;
	/**
	 * What made workers cost it until it ended, its slots' share of each
	 * worker's hours. Absent when it held no slot on one, and from older lines.
	 */
	workerSpend?: WorkerSpend;
	/** What it landed, or for a removed task, what its branch held. Absent from older lines. */
	size?: DiffSize;
	/** For a merge, how long the merge that landed it queued and ran. Absent from older lines. */
	merge?: MergeTimes;
	/** What went worse than it could have. Absent from older lines, never read as none. */
	findings?: Finding[];
	/** The `splates server` conversation that ended it; null for an external agent. */
	conversation: string | null;
	/** The agent `splates add --agent` handed it to, if any. */
	agent: string | null;
	/** The model it was handed over with, if any. */
	model: string | null;
}

/** One time the person moved a conversation off what Autopick set. */
export interface PickOverride {
	/** What they changed. */
	aspect: "model" | "effort";
	/** What they set it to. */
	to: string;
	/** When, as an ISO timestamp. */
	at: string;
	/** The model and effort before and after this change, by name; absent on older overrides. */
	from?: Pairing;
	result?: Pairing;
	/** The id of the lineup whose pick it overrode; absent on older overrides. */
	lineup?: string;
	/** The index of the overridden rule on records that predate lineup IDs. */
	rule?: number;
	/** The kind and depth the task was taken for; null when unsure. */
	kind: string | null;
	depth: string | null;
}

/** What Autopick decided for a task, as its outcome keeps it. */
export interface OutcomeAutopick {
	/** The id of the lineup its cell routed to; null on picks before lineups. */
	lineup: string | null;
	/** The kind and depth it was taken for; null when the judge was unsure. */
	kind: string | null;
	depth: string | null;
	/**
	 * The judge's confidence in each of those, from 0 to 1, as it said of the
	 * likeliest; absent when no judge answered.
	 */
	kindConfidence?: number;
	depthConfidence?: number;
	/** Whom it started the task on: the roster agent, and its model and effort, null for the agent's own. */
	agent: string;
	model: string | null;
	effort: string | null;
	/** Each time it moved the conversation after that, in order. */
	lifts: OutcomeLift[];
	/**
	 * Set when the holdout started it one difficulty easier, as an
	 * experiment: `lineup` above is the easier one it started on, and this
	 * the cell's own. A lift or an override after counts against the step
	 * down. Absent for a task not held out, and from older lines.
	 */
	holdout?: OutcomeHoldout;
}

/** What an outcome keeps of a task the holdout started one difficulty easier. */
export interface OutcomeHoldout {
	holdout: true;
	/** The assignment's version, so a fresh sample is told from an old one. */
	version: string;
	/** The lineup the task's cell routes to, which it was held back from. */
	lineup: string | null;
	/** That lineup's pick, in words: `Opus 5.5, high effort`. */
	from: string;
}

/**
 * What an outcome keeps of `picked`, the Autopick its task's record holds,
 * and the `lifts` its conversation's log shows after: a lift that left the
 * pick where it was is no lift.
 */
export function outcomeAutopick(
	picked: Autopicked,
	lifts: TaskLog["lifts"],
): OutcomeAutopick {
	const classification = picked.classified?.classification;
	return {
		lineup: picked.lineup ?? null,
		kind: picked.kind,
		depth: picked.depth,
		...(classification === undefined
			? {}
			: {
					kindConfidence: likeliest(classification.kinds),
					depthConfidence: likeliest(classification.depth),
				}),
		agent: picked.pick.agent,
		model: picked.pick.model ?? null,
		effort: picked.pick.effort ?? null,
		lifts: lifts
			.filter((each) => each.from === null || !samePick(each.from, each.to))
			.map((each) => ({
				from: each.from,
				to: each.to,
				...(each.why === undefined ? {} : { reason: each.why }),
				at: each.at,
			})),
		...(picked.holdout === undefined
			? {}
			: {
					holdout: {
						holdout: true,
						version: picked.holdout.version,
						lineup: picked.holdout.lineup,
						from: picked.holdout.from,
					},
				}),
	};
}

/** The judge's confidence in the likeliest of `answers`. */
function likeliest(answers: Record<string, number>): number {
	return Math.max(0, ...Object.values(answers));
}

/** Whether `left` and `right` start the same agent, model and effort. */
function samePick(left: AutopickSet, right: AutopickSet): boolean {
	return (
		left.agent === right.agent &&
		left.model === right.model &&
		left.effort === right.effort
	);
}

/** One time Autopick moved a task's conversation after it started. */
export interface OutcomeLift {
	/** The pick it moved off, null when its log kept none. */
	from: AutopickSet | null;
	to: AutopickSet;
	/** Why it moved; absent on lifts logged before it was kept. */
	reason?: LiftReason;
	at: string;
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
