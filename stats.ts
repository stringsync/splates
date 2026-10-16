import type { Judged } from "./adherence";
import { type Baseline, baselines } from "./baselines";
import type { Outcome } from "./outcomes";
import { type Decision, SIZES } from "./plan";
import { CHECKS } from "./skill-checks";
import {
	type MergeFailure,
	REMOVE_REASONS,
	type RemoveReason,
} from "./worktree";

/** What the Stats page shows: how tasks ended, bar by bar and by who did them. */
export interface Stats {
	/**
	 * Each bar of the period, oldest first, those with nothing ended among
	 * them: `start` is when it starts, as an ISO time.
	 */
	buckets: ({ start: string } & Tally)[];
	/**
	 * The as long a span before the period, summed, to compare it with; null
	 * for all time, which has nothing before it.
	 */
	previous: Tally | null;
	/** By the model that ended each task in the period, the most first; null for unknown. */
	models: ({ model: string | null } & Tally)[];
	/**
	 * By where the person worked each task in the period from, the most
	 * first: null for none, as for an external agent, or one that ended
	 * before it was kept.
	 */
	devices: ({ device: WorkedFrom | null } & Tally)[];
	/** By the main tree each task in the period was in, the most first. */
	projects: ({ project: string } & Tally)[];
	/**
	 * By each system a task in the period touched, the most first: a task
	 * counts in each of its systems, and in `null` when it touched none or
	 * ended before systems were kept.
	 */
	systems: ({ system: string | null } & Tally)[];
	/**
	 * Who made the calls tasks in the period made, by size: `SIZES` in order, then any
	 * other word an older scheme used, then null for those with none, which
	 * holds every call from before sizes were kept.
	 */
	sizes: SizeTally[];
	/** When the first outcome was written, the start of what there is to show. */
	since: string | null;
	/**
	 * How conversations followed the arbor skill, by the version each started
	 * on, newest first: over all time, since a version is its own span.
	 */
	skill: SkillVersion[];
	/** Each project's recent merged tasks, to hold one against: over the week before now, whatever the period. */
	baselines: Baseline[];
}

/** How a group of ended tasks went, summed. */
export interface Tally {
	merged: number;
	removed: number;
	/** Of `merged`, those that landed without a person answering a question. */
	clean: number;
	/** Over every task in the group, merged and removed alike. */
	questionRounds: number;
	reviewRounds: number;
	failedMerges: number;
	/** Questions that offered the agent's pick and were answered with a choice. */
	picksAsked: number;
	/** Of `picksAsked`, those answered with another choice. */
	picksOverturned: number;
	/** Of `picksAsked`, those answered with the agent's choice and words added. */
	picksAmended: number;
	/** Calls made without asking. */
	assumptionsMade: number;
	/** Of `assumptionsMade`, those challenged. */
	assumptionsChallenged: number;
	/** Calls the person made: questions put to them, assumptions challenged. */
	decidedByYou: number;
	/** Calls agents made that stood without the person: assumptions left alone. */
	decidedByAgents: number;
	/** Tasks whose time waiting on a person was kept; older ones were not. */
	timed: number;
	/** Of the `timed` tasks, how long they waited on a person, in milliseconds. */
	waitedMs: number;
	/** Of the `timed` tasks, how long they took from add to end, in milliseconds. */
	spentMs: number;
	/** Tasks whose own usage was kept; older ones and external agents' were not. */
	used: number;
	/** Of the `used` tasks, tokens read, those from cache among them, and written. */
	inputTokens: number;
	outputTokens: number;
	/** Of the `used` tasks, those whose agent said what they cost; Codex does not. */
	costed: number;
	/** Of the `costed` tasks, what they cost, summed. */
	cost: number;
	/** Of the `used` tasks, how long their agents worked, in milliseconds. */
	workedMs: number;
	/** Tasks whose diff size was kept. */
	sized: number;
	/** Of the `sized` tasks, the files and lines they changed. */
	filesChanged: number;
	linesAdded: number;
	linesRemoved: number;
	/** Failed merges by why, where it was kept. */
	failedBy: Record<MergeFailure, number>;
	/** Removed tasks by why; `unsaid` for one removed without `--reason`, or before it was kept. */
	removedFor: Record<RemoveReason | "unsaid", number>;
}

/** Who made the calls of one size: the person, or agents without asking. */
export interface SizeTally extends Decided {
	size: string | null;
	/** The same, bar by bar, in the order of `Stats.buckets`. */
	buckets: Decided[];
	/** The same over the as long a span before, as `Stats.previous`; null for all time. */
	previous: Decided | null;
}

/** How many calls the person made, and how many agents made without them. */
export interface Decided {
	decidedByYou: number;
	decidedByAgents: number;
}

/** Where the person spoke to a task's conversation from: a phone, a desktop, or both. */
export type WorkedFrom = "phone" | "desktop" | "both";

/** Where `outcome`'s prompts came from, or null when none was said from the page. */
export function workedFrom(outcome: Outcome): WorkedFrom | null {
	const phone = (outcome.promptsFrom?.phone ?? 0) > 0;
	const desktop = (outcome.promptsFrom?.desktop ?? 0) > 0;
	return phone && desktop
		? "both"
		: phone
			? "phone"
			: desktop
				? "desktop"
				: null;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A week in milliseconds: weeks start on a UTC Monday, so none is short. */
const WEEK = 7 * DAY;

/**
 * The spans the page can look at, as `?period=` names them: how long each
 * runs back from now, and how long each of its bars is.
 */
export const PERIODS = {
	"6h": { span: 6 * HOUR, bucket: 30 * MINUTE },
	"1d": { span: DAY, bucket: HOUR },
	"3d": { span: 3 * DAY, bucket: 3 * HOUR },
	"7d": { span: 7 * DAY, bucket: 6 * HOUR },
} as const;

/** A span in `PERIODS`, or `all` for all time, a bar a week. */
export type PeriodId = keyof typeof PERIODS | "all";

export function isPeriodId(value: string): value is PeriodId {
	return value === "all" || Object.hasOwn(PERIODS, value);
}

/** How long each bar of `period` is, in milliseconds: a week for all time. */
export function bucketOf(period: PeriodId): number {
	return period === "all" ? WEEK : PERIODS[period].bucket;
}

export interface SummarizeOptions {
	period?: PeriodId;
	now?: Date;
	/** Each conversation's skill checks as last judged. */
	judged?: Judged[];
}

/**
 * Sums the outcomes written so far for the page, over `period`. A part,
 * which lands on its caller's branch rather than trunk, is left out: it is a
 * piece of a task that is counted when its caller ends.
 */
export function summarize(
	outcomes: Outcome[],
	{ period = "7d", now = new Date(), judged = [] }: SummarizeOptions = {},
): Stats {
	const tasks = outcomes.filter((each) => !each.base.startsWith("task/"));
	const since = tasks[0]?.endedAt ?? null;
	// All time runs a week a bar from the week the first task ended, or this
	// week alone; the rest a bar each `bucket`, cut on the clock.
	const bucket = bucketOf(period);
	const floor =
		period === "all"
			? (at: number) => weekOf(new Date(at)).getTime()
			: (at: number) => Math.floor(at / bucket) * bucket;
	const last = floor(now.getTime());
	const length =
		period === "all"
			? since === null
				? 1
				: Math.round((last - floor(Date.parse(since))) / WEEK) + 1
			: PERIODS[period].span / bucket;
	const first = last - (length - 1) * bucket;
	const inPeriod = tasks.filter(
		(each) => floor(Date.parse(each.endedAt)) >= first,
	);
	const before = first - length * bucket;
	const earlier =
		period === "all"
			? null
			: tasks.filter((each) => {
					const at = floor(Date.parse(each.endedAt));
					return at >= before && at < first;
				});
	return {
		buckets: Array.from({ length }, (_, index) => {
			const start = first + index * bucket;
			return {
				start: new Date(start).toISOString(),
				...tally(
					inPeriod.filter((each) => floor(Date.parse(each.endedAt)) === start),
				),
			};
		}),
		previous: earlier === null ? null : tally(earlier),
		models: grouped(inPeriod, (each) => each.model).map(([model, tally]) => ({
			model,
			...tally,
		})),
		devices: grouped(inPeriod, workedFrom).map(([device, tally]) => ({
			device,
			...tally,
		})),
		projects: grouped(inPeriod, (each) => each.project).map(
			([project, tally]) => ({ project, ...tally }),
		),
		systems: grouped(
			inPeriod.flatMap((each) =>
				each.systems?.length
					? each.systems.map((system) => ({ ...each, systems: [system] }))
					: [{ ...each, systems: [] }],
			),
			(each) => each.systems?.[0] ?? null,
		).map(([system, tally]) => ({ system, ...tally })),
		sizes: sizeTallies(inPeriod, earlier, length, (each) =>
			Math.round((floor(Date.parse(each.endedAt)) - first) / bucket),
		),
		since,
		skill: rates(judged),
		baselines: baselines(outcomes, now),
	};
}

function tally(outcomes: Outcome[]): Tally {
	const merged = outcomes.filter((each) => each.ended === "merged");
	const timed = outcomes.filter((each) => each.waitedMs !== undefined);
	const used = outcomes.filter((each) => each.usage !== undefined);
	const costed = used.filter((each) => each.usage?.cost != null);
	const sized = outcomes.filter((each) => each.size !== undefined);
	const removedFor = blank(["unsaid", ...REMOVE_REASONS]);
	for (const each of outcomes) {
		if (each.ended === "removed") {
			removedFor[each.removedFor ?? "unsaid"]++;
		}
	}
	const failedBy = blank(MERGE_FAILURES);
	for (const each of outcomes) {
		for (const reason of MERGE_FAILURES) {
			failedBy[reason] += each.failedMergesBy?.[reason] ?? 0;
		}
	}
	return {
		merged: merged.length,
		removed: outcomes.length - merged.length,
		clean: merged.filter((each) => each.questionRounds === 0).length,
		questionRounds: sum(outcomes, (each) => each.questionRounds),
		reviewRounds: sum(outcomes, (each) => each.reviewRounds),
		failedMerges: sum(outcomes, (each) => each.failedMerges),
		picksAsked: sum(outcomes, (each) => each.picksAsked ?? 0),
		picksOverturned: sum(outcomes, (each) => each.picksOverturned ?? 0),
		picksAmended: sum(outcomes, (each) => each.picksAmended ?? 0),
		assumptionsMade: sum(outcomes, (each) => each.assumptionsMade ?? 0),
		assumptionsChallenged: sum(
			outcomes,
			(each) => each.assumptionsChallenged ?? 0,
		),
		decidedByYou: decidedBy(outcomes, "decidedByYou"),
		decidedByAgents: decidedBy(outcomes, "decidedByAgents"),
		timed: timed.length,
		waitedMs: sum(timed, (each) => each.waitedMs ?? 0),
		spentMs: sum(
			timed,
			(each) => Date.parse(each.endedAt) - Date.parse(each.startedAt),
		),
		used: used.length,
		inputTokens: sum(used, (each) => each.usage?.input ?? 0),
		outputTokens: sum(used, (each) => each.usage?.output ?? 0),
		costed: costed.length,
		cost: sum(costed, (each) => each.usage?.cost?.amount ?? 0),
		workedMs: sum(used, (each) => each.workedMs ?? 0),
		sized: sized.length,
		filesChanged: sum(sized, (each) => each.size?.files ?? 0),
		linesAdded: sum(sized, (each) => each.size?.added ?? 0),
		linesRemoved: sum(sized, (each) => each.size?.removed ?? 0),
		failedBy,
		removedFor,
	};
}

/**
 * Who made the calls in `outcomes`, by size, in the order `Stats.sizes`
 * gives, each over the period and in each of its `length` bars, `barOf`
 * saying which bar an outcome ended in, and over the span before it, from
 * `earlier`: a size from either gets a row.
 */
function sizeTallies(
	outcomes: Outcome[],
	earlier: Outcome[] | null,
	length: number,
	barOf: (outcome: Outcome) => number,
): SizeTally[] {
	const none = (): Decided => ({ decidedByYou: 0, decidedByAgents: 0 });
	const bySize = new Map<string | null, SizeTally>();
	const rowOf = (size: string | null): SizeTally => {
		const row = bySize.get(size) ?? {
			size,
			...none(),
			buckets: Array.from({ length }, none),
			previous: earlier === null ? null : none(),
		};
		bySize.set(size, row);
		return row;
	};
	for (const outcome of outcomes) {
		const bar = barOf(outcome);
		for (const [decision, count] of decided(outcome)) {
			const row = rowOf(decision.size);
			row[whose(decision)] += count;
			const inBar = row.buckets[bar];
			if (inBar !== undefined) {
				inBar[whose(decision)] += count;
			}
		}
	}
	for (const outcome of earlier ?? []) {
		for (const [decision, count] of decided(outcome)) {
			const { previous } = rowOf(decision.size);
			if (previous !== null) {
				previous[whose(decision)] += count;
			}
		}
	}
	const rank = (size: string | null): number => {
		const at = SIZES.indexOf(size as (typeof SIZES)[number]);
		return at !== -1 ? at : size === null ? SIZES.length + 1 : SIZES.length;
	};
	return [...bySize.values()].sort(
		(one, other) =>
			rank(one.size) - rank(other.size) ||
			(one.size ?? "").localeCompare(other.size ?? ""),
	);
}

/**
 * Who made `decision`: the person, for one put to them or an assumption
 * they challenged, which took their attention either way; otherwise the
 * agent, whose assumption stood without them.
 */
function whose(
	decision: Pick<Decision, "how" | "ended">,
): "decidedByYou" | "decidedByAgents" {
	return decision.how === "asked" || decision.ended === "challenged"
		? "decidedByYou"
		: "decidedByAgents";
}

/** How many calls in `outcomes` `who` made. */
function decidedBy(outcomes: Outcome[], who: ReturnType<typeof whose>): number {
	return sum(outcomes, (outcome) =>
		sum(decided(outcome), ([decision, count]) =>
			whose(decision) === who ? count : 0,
		),
	);
}

/**
 * The calls `outcome` made, each with how many it stands for: its own
 * decisions one each, or for a line from before they were kept, its counts
 * read back as unsized calls.
 */
function decided(
	outcome: Outcome,
): [Pick<Decision, "size" | "how" | "ended">, number][] {
	if (outcome.decisions !== undefined) {
		return outcome.decisions.map((each) => [each, 1]);
	}
	const picked = outcome.picksAsked ?? 0;
	const overturned = outcome.picksOverturned ?? 0;
	const amended = outcome.picksAmended ?? 0;
	const challenged = outcome.assumptionsChallenged ?? 0;
	const unsized = (
		how: Decision["how"],
		ended: Decision["ended"],
		count: number,
	): [Pick<Decision, "size" | "how" | "ended">, number] => [
		{ size: null, how, ended },
		Math.max(0, count),
	];
	return [
		unsized("asked", "kept", picked - overturned - amended),
		unsized("asked", "amended", amended),
		unsized("asked", "overturned", overturned),
		// `questionsAsked` counts challenged assumptions, which moved there.
		unsized("asked", null, (outcome.questionsAsked ?? 0) - picked - challenged),
		unsized("assumed", "kept", (outcome.assumptionsMade ?? 0) - challenged),
		unsized("assumed", "challenged", challenged),
	].filter(([, count]) => count > 0);
}

/** Tallies added up, as for the bars of a period. */
export function combine(tallies: Tally[]): Tally {
	const total = tally([]);
	for (const each of tallies) {
		for (const key of SUMMED) {
			total[key] += each[key];
		}
		for (const reason of MERGE_FAILURES) {
			total.failedBy[reason] += each.failedBy[reason];
		}
		for (const reason of ["unsaid", ...REMOVE_REASONS] as const) {
			total.removedFor[reason] += each.removedFor[reason];
		}
	}
	return total;
}

/** Every count in a tally that adds up as a plain number. */
const SUMMED = [
	"merged",
	"removed",
	"clean",
	"questionRounds",
	"reviewRounds",
	"failedMerges",
	"picksAsked",
	"picksOverturned",
	"picksAmended",
	"assumptionsMade",
	"assumptionsChallenged",
	"decidedByYou",
	"decidedByAgents",
	"timed",
	"waitedMs",
	"spentMs",
	"used",
	"inputTokens",
	"outputTokens",
	"costed",
	"cost",
	"workedMs",
	"sized",
	"filesChanged",
	"linesAdded",
	"linesRemoved",
] as const;

const MERGE_FAILURES: MergeFailure[] = [
	"conflict",
	"tests_failed",
	"merge_failed",
];

/** A count of 0 for each of `keys`. */
function blank<K extends string>(keys: readonly K[]): Record<K, number> {
	return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

function grouped<K>(
	outcomes: Outcome[],
	key: (outcome: Outcome) => K,
): [K, Tally][] {
	const groups = Map.groupBy(outcomes, key);
	return [...groups]
		.sort(([, one], [, other]) => other.length - one.length)
		.map(([each, members]) => [each, tally(members)]);
}

function sum<T>(items: T[], count: (item: T) => number): number {
	return items.reduce((total, each) => total + count(each), 0);
}

/** The Monday, UTC, that starts the week `at` falls in. */
function weekOf(at: Date): Date {
	const start = new Date(
		Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
	);
	start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
	return start;
}

/** How one check went over the conversations on one skill version. */
export interface CheckRate {
	id: string;
	rule: string;
	/** The conversations it applied in. */
	applied: number;
	/** Of `applied`, those where it passed every time. */
	passed: number;
}

/** How the conversations on one arbor skill version followed it. */
export interface SkillVersion {
	/** Null for conversations whose version is unknown. */
	skill: string | null;
	conversations: number;
	checks: CheckRate[];
}

/** Each skill version's pass rates, the newest version first and unknown last. */
export function rates(judged: Judged[]): SkillVersion[] {
	return [...Map.groupBy(judged, (each) => each.skill)]
		.sort(([one], [other]) => newerFirst(one, other))
		.map(([skill, members]) => ({
			skill,
			conversations: members.length,
			checks: CHECKS.map(({ id, rule }) => {
				const applied = members.filter((each) => each.scores[id] !== undefined);
				return {
					id,
					rule,
					applied: applied.length,
					passed: applied.filter((each) => each.scores[id]?.failed === 0)
						.length,
				};
			}),
		}));
}

/** Orders versions newest first, null last. */
function newerFirst(one: string | null, other: string | null): number {
	if (one === null || other === null) {
		return one === other ? 0 : one === null ? 1 : -1;
	}
	// By each number in turn, so `0.0.10` is newer than `0.0.9`.
	const [left, right] = [one, other].map((each) => each.split(".").map(Number));
	for (let i = 0; i < Math.max(left?.length ?? 0, right?.length ?? 0); i += 1) {
		const diff = (right?.[i] ?? 0) - (left?.[i] ?? 0);
		if (diff !== 0 && !Number.isNaN(diff)) {
			return diff;
		}
	}
	return other.localeCompare(one);
}
