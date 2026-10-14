import type { Tally } from "../stats";

/** Which card an `Advice` is, for the page to rank it and give it its chart. */
export type AdviceId =
	| "course"
	| "picks"
	| "assumptions"
	| "waiting"
	| "hotspot"
	| "failures"
	| "removals";

/** One figure worth acting on, and what to do about it. */
export interface Advice {
	id: AdviceId;
	title: string;
	/** Shown large: `12%`; null when too little was kept to say. */
	figure: string | null;
	/** What the figure counts, in a line. */
	detail: string;
	/** The system the card is about, shown as its chip beside the title. */
	system?: string;
	/** What to change, given the figure; null when nothing stands out. */
	act: string | null;
	/** How much more the card needs before it can say anything; null when it has enough. */
	short: string | null;
	/**
	 * How the figure moved since the as long a span before, and whether that is
	 * better; null for all time, or with too little before to compare.
	 */
	trend: string | null;
}

/** What `advise` reads: the period, the span before it, and its systems. */
export interface AdviseInput {
	period: Tally;
	/** The as long a span before; null for all time, which has nothing before. */
	previous: Tally | null;
	systems: { system: string | null; tally: Tally }[];
	/** The period's name, for "the 7 days before". */
	span: string;
}

/** Below this many of a thing, a share says more about chance than habit. */
export const ENOUGH = 5;

/** At or under this share overturned, agents are asking what they could decide. */
export const AGREE = 0.1;

/** At or over this share overturned, agents are guessing without what they need. */
export const DISAGREE = 0.3;

/** At or over this share of task time waiting on you, you set the pace. */
export const WAITING = 0.5;

/** A system draws questions when its tasks ask this many times the average. */
export const HOTSPOT = 1.5;

/** A figure moved when it changed by at least this share of what it was. */
export const MOVED = 0.2;

/**
 * What the period's outcomes say to change, one card each: whether agents
 * need the person more or less than before, how often the person overturns
 * the agents' picks, how long tasks wait on them, which system draws the
 * questions, and why merges fail and tasks are removed. Each is a fixed rule
 * over the counts, so the same outcomes always say the same.
 */
export function advise({
	period,
	previous,
	systems,
	span,
}: AdviseInput): Advice[] {
	const before = new Before(previous, span);
	return [
		course(period, before),
		picks(period, before),
		assumptions(period, before),
		waiting(period, before),
		hotspot(period, systems),
		failures(period, before),
		removals(period, before),
	];
}

/** One figure of a tally: how to read it, what it needs, and how it is shown. */
interface Measure {
	of: (tally: Tally) => number | null;
	/** What the figure is a share or rate of; under `ENOUGH`, it is not compared. */
	count: (tally: Tally) => number;
	shown: (value: number) => string;
	/**
	 * What follows the figure when the card shows another, so the trend
	 * says this one's: `a task`.
	 */
	apart?: string;
}

/** The span before the period, which each figure is compared with. */
class Before {
	constructor(
		private readonly tally: Tally | null,
		private readonly span: string,
	) {}

	/**
	 * How `measure` moved into `period`, every figure here being better lower:
	 * `Down from 18% the 7 days before: better`.
	 */
	trend(period: Tally, measure: Measure): string | null {
		const now = measure.of(period);
		const was = this.was(measure);
		if (now === null || was === null) {
			return null;
		}
		const before = `${measure.shown(was)} the ${this.span} before`;
		const lead = measure.apart
			? `${measure.shown(now)} ${measure.apart}, `
			: "";
		if (!moved(now, was)) {
			return `${lead}${lead ? "about" : "About"} the same as ${before}`;
		}
		return now < was
			? `${lead}${lead ? "down" : "Down"} from ${before}: better`
			: `${lead}${lead ? "up" : "Up"} from ${before}: worse`;
	}

	/** Which way `measure` moved into `period`, or null when it held or cannot say. */
	direction(period: Tally, measure: Measure): "up" | "down" | null {
		const now = measure.of(period);
		const was = this.was(measure);
		if (
			now === null ||
			was === null ||
			measure.count(period) < ENOUGH ||
			!moved(now, was)
		) {
			return null;
		}
		return now < was ? "down" : "up";
	}

	private was(measure: Measure): number | null {
		return this.tally === null || measure.count(this.tally) < ENOUGH
			? null
			: measure.of(this.tally);
	}
}

function moved(now: number, was: number): boolean {
	return was === 0 ? now > 0 : Math.abs(now - was) / was >= MOVED;
}

const QUESTIONS: Measure = {
	of: (tally) =>
		ended(tally) === 0 ? null : tally.questionRounds / ended(tally),
	count: ended,
	shown: decimal,
};

const OVERTURNED: Measure = {
	of: (tally) =>
		tally.picksAsked === 0 ? null : tally.picksOverturned / tally.picksAsked,
	count: (tally) => tally.picksAsked,
	shown: percent,
};

const CHALLENGED: Measure = {
	of: (tally) =>
		tally.assumptionsMade === 0
			? null
			: tally.assumptionsChallenged / tally.assumptionsMade,
	count: (tally) => tally.assumptionsMade,
	shown: percent,
};

const WAITED: Measure = {
	of: (tally) => (tally.spentMs === 0 ? null : tally.waitedMs / tally.spentMs),
	count: (tally) => tally.timed,
	shown: percent,
};

const FAILURES: Measure = {
	of: (tally) =>
		ended(tally) === 0 ? null : tally.failedMerges / ended(tally),
	count: ended,
	shown: decimal,
	apart: "a task",
};

const REMOVED: Measure = {
	of: (tally) => (ended(tally) === 0 ? null : tally.removed / ended(tally)),
	count: ended,
	shown: percent,
	apart: "of tasks",
};

function course(period: Tally, before: Before): Advice {
	const now = QUESTIONS.of(period);
	const direction = before.direction(period, QUESTIONS);
	return {
		id: "course",
		title: "Questions per task",
		figure: now === null ? null : decimal(now),
		detail: `times a task was handed to you, over ${plural(ended(period), "task")}`,
		act:
			direction === "down"
				? "Agents need you less than before: keep whatever changed, and write it into CLAUDE.md if it is not there yet."
				: direction === "up"
					? "Agents need you more than before: look at By model and By system for where, and at what changed in prompts or the work."
					: null,
		short: needs(
			ENOUGH - ended(period),
			"more task ended to say",
			"more tasks ended to say",
		),
		trend: before.trend(period, QUESTIONS),
	};
}

function picks(period: Tally, before: Before): Advice {
	const { picksAsked, picksOverturned, picksAmended } = period;
	const share = OVERTURNED.of(period);
	return {
		id: "picks",
		title: "Picks you overturned",
		figure: share === null ? null : percent(share),
		detail: `${picksOverturned} of ${picksAsked} questions where the agent said what it would pick; ${picksAmended} more you took with words added`,
		act:
			share === null || picksAsked < ENOUGH
				? null
				: share >= DISAGREE
					? "Agents often pick wrong: give them what they are missing, in CLAUDE.md, memory or the task's prompt."
					: picksAmended / picksAsked >= DISAGREE
						? "Agents pick right but miss details: what you add to their picks belongs in CLAUDE.md or memory."
						: share <= AGREE
							? "You almost always agree: let agents make these calls without asking, in the arbor skill's Asking as you go."
							: null,
		short: needs(
			ENOUGH - picksAsked,
			"more question offering a pick to say",
			"more questions offering a pick to say",
		),
		trend: before.trend(period, OVERTURNED),
	};
}

function assumptions(period: Tally, before: Before): Advice {
	const { assumptionsMade, assumptionsChallenged } = period;
	const share = CHALLENGED.of(period);
	return {
		id: "assumptions",
		title: "Assumptions you challenged",
		figure: share === null ? null : percent(share),
		detail: `${assumptionsChallenged} of ${assumptionsMade} calls agents made without asking`,
		act:
			share === null || assumptionsMade < ENOUGH
				? null
				: share >= DISAGREE
					? "Agents often assume wrong: have them ask more in the arbor skill's Asking as you go, or give them what they miss."
					: share <= AGREE
						? "You almost never challenge them: let agents assume more and ask less, in the arbor skill's Asking as you go."
						: null,
		short: needs(
			ENOUGH - assumptionsMade,
			"more assumption to say",
			"more assumptions to say",
		),
		trend: before.trend(period, CHALLENGED),
	};
}

function waiting(period: Tally, before: Before): Advice {
	const { timed, waitedMs } = period;
	const share = WAITED.of(period);
	return {
		id: "waiting",
		title: "Time waiting on you",
		figure: share === null ? null : percent(share),
		detail: `of the time from add to end, over ${plural(timed, "task")}; ${duration(waitedMs / Math.max(timed, 1))} a task`,
		act:
			share === null || timed < ENOUGH || share < WAITING
				? null
				: "Tasks spend most of their time waiting on you: answer them in batches, or let agents decide more.",
		short: needs(
			ENOUGH - timed,
			"more task timed to say",
			"more tasks timed to say",
		),
		trend: before.trend(period, WAITED),
	};
}

function hotspot(
	period: Tally,
	systems: { system: string | null; tally: Tally }[],
): Advice {
	const average = QUESTIONS.of(period);
	const named = systems
		.filter(({ system, tally }) => system !== null && ended(tally) >= ENOUGH)
		.map(({ system, tally }) => ({ system, rate: QUESTIONS.of(tally) ?? 0 }))
		.sort((one, other) => other.rate - one.rate);
	const top = named[0];
	return {
		id: "hotspot",
		title: "Questions by system",
		figure: top ? decimal(top.rate) : null,
		detail: top
			? `questions a task, against ${decimal(average ?? 0)} overall`
			: `No system has ${ENOUGH} tasks yet`,
		...(top?.system ? { system: top.system } : {}),
		act:
			top && average !== null && top.rate >= average * HOTSPOT && top.rate > 0
				? "It draws the most questions: write down what agents keep asking about it, in CLAUDE.md or a scry rule."
				: null,
		short: top
			? null
			: `Needs ${ENOUGH} tasks ended in one system to say where questions come from`,
		// Which system tops the list moves with the work, not with how agents
		// do, so it is not compared.
		trend: null,
	};
}

function failures(period: Tally, before: Before): Advice {
	const { failedMerges, failedBy } = period;
	const [reason, count] = Object.entries(failedBy).sort(
		([, one], [, other]) => other - one,
	)[0] ?? ["", 0];
	return {
		id: "failures",
		title: "Why merges failed",
		figure: String(failedMerges),
		detail:
			failedMerges === 0
				? "No merge failed"
				: `${failedBy.conflict} conflicted, ${failedBy.tests_failed} failed checks, ${failedBy.merge_failed} could not move the base`,
		act:
			count < ENOUGH
				? null
				: reason === "conflict"
					? "Most failures are conflicts: tasks overlap, so put work on the same files in one lane."
					: reason === "tests_failed"
						? "Most failures are failed checks: have agents run the project's checks before they merge."
						: "Most failures are a base that would not move: commit or clear what sits in the main tree.",
		// With none failed there is nothing to explain, so nothing is short.
		short:
			failedMerges === 0
				? null
				: needs(
						ENOUGH - count,
						"more failure of one kind to say why",
						"more failures of one kind to say why",
					),
		trend: before.trend(period, FAILURES),
	};
}

function removals(period: Tally, before: Before): Advice {
	const { removed, removedFor } = period;
	const said = removed - removedFor.unsaid;
	const [reason, count] = Object.entries(removedFor)
		.filter(([key]) => key !== "unsaid")
		.sort(([, one], [, other]) => other - one)[0] ?? ["", 0];
	return {
		id: "removals",
		title: "Why tasks were removed",
		figure: String(removed),
		detail:
			removed === 0
				? "None removed"
				: `${removedFor.redo} to redo, ${removedFor.superseded} superseded, ${removedFor.moot} moot, ${removedFor.nothing} with nothing to change, ${removedFor.unsaid} unsaid`,
		act:
			said < ENOUGH
				? null
				: reason === "redo"
					? "Tasks go stale against trunk: keep them smaller, and merge sooner."
					: reason === "superseded"
						? "Tasks duplicate each other: check `arbor list --files` before starting."
						: count > 0
							? "Tasks start on work nobody needs: settle what done means before starting."
							: null,
		short:
			removed === 0
				? null
				: needs(
						ENOUGH - said,
						"more removal with a reason to say why",
						"more removals with a reason to say why",
					),
		trend: before.trend(period, REMOVED),
	};
}

function ended(tally: Tally): number {
	return tally.merged + tally.removed;
}

/** `Needs 3 more tasks ended to say`, or null with none missing. */
function needs(missing: number, one: string, many: string): string | null {
	if (missing <= 0) {
		return null;
	}
	return `Needs ${missing} ${missing === 1 ? one : many}`;
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function percent(share: number): string {
	return `${Math.round(share * 100)}%`;
}

export function decimal(value: number): string {
	return value.toFixed(1);
}

/** `45m`, `3.2h` or `2.1d`: as long as it reads at a glance. */
export function duration(ms: number): string {
	const minutes = ms / 60_000;
	if (minutes < 60) {
		return `${Math.round(minutes)}m`;
	}
	const hours = minutes / 60;
	return hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
}
