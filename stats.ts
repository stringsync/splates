import type { Judged } from "./adherence";
import type { Outcome } from "./outcomes";
import { CHECKS } from "./skill-checks";
import {
	type MergeFailure,
	REMOVE_REASONS,
	type RemoveReason,
} from "./worktree";

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
	/** Tasks whose time waiting on a person was kept; older ones were not. */
	timed: number;
	/** Of the `timed` tasks, how long they waited on a person, in milliseconds. */
	waitedMs: number;
	/** Of the `timed` tasks, how long they took from add to end, in milliseconds. */
	spentMs: number;
	/** Failed merges by why, where it was kept. */
	failedBy: Record<MergeFailure, number>;
	/** Removed tasks by why; `unsaid` for one removed without `--reason`, or before it was kept. */
	removedFor: Record<RemoveReason | "unsaid", number>;
}

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
	/** When the first outcome was written, the start of what there is to show. */
	since: string | null;
	/**
	 * How conversations followed the arbor skill, by the version each started
	 * on, newest first: over all time, since a version is its own span.
	 */
	skill: SkillVersion[];
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
	const bucket = period === "all" ? WEEK : PERIODS[period].bucket;
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
		previous:
			period === "all"
				? null
				: tally(
						tasks.filter((each) => {
							const at = floor(Date.parse(each.endedAt));
							return at >= before && at < first;
						}),
					),
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
		since,
		skill: rates(judged),
	};
}

function tally(outcomes: Outcome[]): Tally {
	const merged = outcomes.filter((each) => each.ended === "merged");
	const timed = outcomes.filter((each) => each.waitedMs !== undefined);
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
		timed: timed.length,
		waitedMs: sum(timed, (each) => each.waitedMs ?? 0),
		spentMs: sum(
			timed,
			(each) => Date.parse(each.endedAt) - Date.parse(each.startedAt),
		),
		failedBy,
		removedFor,
	};
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
	"timed",
	"waitedMs",
	"spentMs",
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

function sum(outcomes: Outcome[], count: (outcome: Outcome) => number): number {
	return outcomes.reduce((total, each) => total + count(each), 0);
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
