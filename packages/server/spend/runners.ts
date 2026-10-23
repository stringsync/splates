import { type SpendShare, splitSpend } from "../workers/browser";
import { periodStart, type SpendEntry } from "./totals";

/** Whether a line of the ledger is a runner's row rather than an amount spent. */
export function isRunnerRow(line: SpendEntry | RunnerRow): line is RunnerRow {
	return "row" in line;
}

/**
 * A runner made, as the ledger keeps it: written as it is asked for, and
 * again should its price change, the last for an id counting.
 */
export interface RunnerMadeRow {
	row: "runner";
	/** The worker's id, as `c-16-ab12cd`. */
	id: string;
	/** Its machine type, the provider's own name for it, as `c-16`, which the bill names it by. */
	type: string;
	/** Its CPUs and memory in GB; absent in a row from before they were kept, or from a provider that does not say. */
	cpus?: number;
	memory?: number;
	/** The provider whose bill it is on, as `fly`; null when no bill is pulled for it. */
	provider: string | null;
	/** What it costs an hour, in US dollars, as the provider's API said when it was made. */
	dollarsPerHour: number;
	/** What it costs an hour while stopped, its disk alone; absent for a provider that keeps no stopped runner. */
	stoppedDollarsPerHour?: number;
	/** When it was asked for, as an ISO timestamp. */
	at: string;
}

/** A runner's machine stopped, as one does `idle` after its last job, kept to start again: from here it costs only `stoppedDollarsPerHour`. */
export interface RunnerStoppedRow {
	row: "runner-stopped";
	id: string;
	/** When it stopped, as near as that is known, as an ISO timestamp. */
	at: string;
}

/** A stopped runner's machine started again for a job: it costs `dollarsPerHour` from here. */
export interface RunnerStartedRow {
	row: "runner-started";
	id: string;
	at: string;
}

/** A runner destroyed, as the ledger keeps it. */
export interface RunnerEndedRow {
	row: "runner-ended";
	id: string;
	/** When it was destroyed, as an ISO timestamp. */
	at: string;
}

/** One heavy job a runner ran, as the ledger keeps it once it ends. */
export interface RunnerJobRow {
	row: "job";
	/** The job's id. */
	id: string;
	/** The runner it ran on. */
	runner: string;
	/** The project's main tree. */
	project: string;
	task: string | null;
	/** What it ran, shortened. */
	what: string;
	/** When it took its place, as an ISO timestamp. */
	at: string;
	/** When it gave its place up, as an ISO timestamp; null in a job running now, which the ledger never keeps. */
	until: string | null;
}

/** A row of the ledger that is no amount spent: runners and their jobs, which estimates are counted from. */
export type RunnerRow =
	| RunnerMadeRow
	| RunnerStoppedRow
	| RunnerStartedRow
	| RunnerEndedRow
	| RunnerJobRow;

/** One runner's life, as the Billing page lists it. */
export interface RunnerLife {
	id: string;
	/** The provider's own name for its machine type. */
	type: string;
	/** Its CPUs and memory in GB, null where the ledger does not say. */
	size: { cpus: number; memory: number } | null;
	provider: string | null;
	dollarsPerHour: number;
	/** What it costs an hour while stopped; null for a provider that keeps no stopped runner. */
	stoppedDollarsPerHour: number | null;
	/** Whether it runs now, is stopped and kept, or is destroyed. */
	state: "running" | "stopped" | "destroyed";
	/** When it was made, and destroyed, as ISO timestamps; `until` is null while it is kept. */
	from: string;
	until: string | null;
	/** Hours it ran, to now for one running now. */
	hours: number;
	/** Hours it was stopped and kept, to now for one stopped now. */
	stoppedHours: number;
	/** What it cost, an estimate: its running hours at `dollarsPerHour`, its stopped ones at `stoppedDollarsPerHour`. */
	dollars: number;
	/** How many jobs it ran, those running now included. */
	jobs: number;
}

/** Runner-hours and their estimated dollars in one day or month. */
export interface RunnerPeriod {
	/** Its first day, `2026-10-21`, or the 1st for a month, in UTC as the ledger's days are. */
	period: string;
	/** Hours runners ran, stopped ones not counted. */
	hours: number;
	/** Their running hours' dollars and their stopped ones' storage together. */
	dollars: number;
}

/** A month of runners, with what the providers billed for it beside the estimate. */
export interface RunnerMonth extends RunnerPeriod {
	/** What the runners' providers billed for the month, as pulled; null until a bill is. */
	billed: number | null;
	/** How far the estimate is off the bill, in percent of the bill; null without a bill. */
	gap: number | null;
}

/** Who one day's or month's runner cost went to. */
export interface RunnerSplit {
	period: string;
	/** By project and task, the most first, the idle time shared as `splitSpend` does. */
	shares: SpendShare[];
}

/** A snapshot runners boot from, which costs to keep. */
export interface RunnerImage {
	id: string;
	gigabytes: number;
	/** In US dollars, as the provider's API prices it. */
	dollarsPerMonth: number;
}

/** What the Billing page shows of runners. */
export interface RunnersReport {
	/** When it was read, as an ISO timestamp. */
	updated: string;
	/** Every runner ever made, the newest first. */
	runners: RunnerLife[];
	/** The snapshots runners boot from, with what each costs to keep a month. */
	images: RunnerImage[];
	/** Each of the last `RUNNER_DAYS` days, oldest first, today last. */
	days: RunnerPeriod[];
	/** Each month from the first runner's to this one, oldest first. */
	months: RunnerMonth[];
	/** The split by task of each day and month that had runner cost. */
	split: { days: RunnerSplit[]; months: RunnerSplit[] };
}

/** How many days back the Billing page's runner days go. */
export const RUNNER_DAYS = 90;

/**
 * What the ledger says of runners at `now`: each life, at the price it was
 * made at, by day and by month, each month beside what its providers
 * billed, and who each day's and month's cost went to, counted per job.
 * `running` are the jobs running now, which the ledger keeps once they end.
 */
export function runnersReport(
	lines: readonly (SpendEntry | RunnerRow)[],
	now: number,
	running: readonly RunnerJobRow[] = [],
	images: readonly RunnerImage[] = [],
): RunnersReport {
	const { lives, runs, jobs, bills } = readRows(lines, running);
	const runners: RunnerLife[] = lives
		.map(({ row, life, spans }) => {
			let hours = 0;
			let stoppedHours = 0;
			let dollars = 0;
			for (const span of spans) {
				const spent = ((span.until ?? now) - span.from) / HOUR;
				if (span.stopped) {
					stoppedHours += spent;
				} else {
					hours += spent;
				}
				dollars += spent * span.dollarsPerHour;
			}
			const open = spans.at(-1);
			return {
				id: row.id,
				type: row.type,
				size:
					row.cpus === undefined || row.memory === undefined
						? null
						: { cpus: row.cpus, memory: row.memory },
				provider: row.provider,
				dollarsPerHour: row.dollarsPerHour,
				stoppedDollarsPerHour: row.stoppedDollarsPerHour ?? null,
				state:
					life.until !== null
						? ("destroyed" as const)
						: open?.stopped === true
							? ("stopped" as const)
							: ("running" as const),
				from: row.at,
				until: life.until === null ? null : new Date(life.until).toISOString(),
				hours,
				stoppedHours,
				dollars,
				jobs: jobs.filter((job) => job.runner === row.id).length,
			};
		})
		.sort((one, other) => other.from.localeCompare(one.from));
	const today = Date.parse(periodStart(new Date(now).toISOString(), "day"));
	const dayStarts = Array.from(
		{ length: RUNNER_DAYS },
		(_, at) => today - (RUNNER_DAYS - 1 - at) * DAY,
	);
	const firstMonth =
		lives.length === 0 ? null : Math.min(...lives.map(({ life }) => life.from));
	const monthStarts: number[] = [];
	if (firstMonth !== null) {
		const month = new Date(
			`${periodStart(new Date(firstMonth).toISOString(), "month")}T00:00:00Z`,
		);
		while (month.getTime() <= now) {
			monthStarts.push(month.getTime());
			month.setUTCMonth(month.getUTCMonth() + 1);
		}
	}
	const used = (since: number, until: number): RunnerPeriod => {
		let hours = 0;
		let dollars = 0;
		for (const span of lives.flatMap(({ spans }) => spans)) {
			const ms =
				Math.min(span.until ?? now, until, now) - Math.max(span.from, since);
			if (ms > 0) {
				hours += span.stopped ? 0 : ms / HOUR;
				dollars += (ms / HOUR) * span.dollarsPerHour;
			}
		}
		return { period: dayOf(since), hours, dollars };
	};
	const providers = new Set(
		lives.flatMap(({ row }) => (row.provider === null ? [] : [row.provider])),
	);
	const months = monthStarts.map((since): RunnerMonth => {
		const period = used(since, nextMonth(since));
		const charged = bills.filter(
			(bill) =>
				providers.has(bill.provider) &&
				periodStart(bill.at, "month") === period.period,
		);
		const billed =
			charged.length === 0
				? null
				: charged.reduce((sum, bill) => sum + bill.dollars, 0);
		return {
			...period,
			billed,
			gap:
				billed === null || billed <= 0
					? null
					: ((period.dollars - billed) / billed) * 100,
		};
	});
	const split = (since: number, until: number): RunnerSplit => ({
		period: dayOf(since),
		shares: splitSpend(
			lives.flatMap(({ spans }) => spans),
			runs,
			since,
			Math.min(until, now),
		),
	});
	const spent = (each: RunnerSplit) => each.shares.length > 0;
	return {
		updated: new Date(now).toISOString(),
		runners,
		images: [...images],
		days: dayStarts.map((since) => used(since, since + DAY)),
		months,
		split: {
			days: dayStarts.map((since) => split(since, since + DAY)).filter(spent),
			months: monthStarts
				.map((since) => split(since, nextMonth(since)))
				.filter(spent),
		},
	};
}

/** The runners' lives, each job as a run on one, and the bills, read from the ledger's `lines` and the jobs `running`. */
function readRows(
	lines: readonly (SpendEntry | RunnerRow)[],
	running: readonly RunnerJobRow[],
) {
	const made = new Map<string, RunnerMadeRow>();
	const ended = new Map<string, number>();
	const turns = new Map<string, { stopped: boolean; at: number }[]>();
	const jobs: RunnerJobRow[] = [...running];
	const bills: SpendEntry[] = [];
	for (const line of lines) {
		if (!isRunnerRow(line)) {
			if (line.kind === "billed") {
				bills.push(line);
			}
			continue;
		}
		if (line.row === "runner") {
			const first = made.get(line.id);
			// A price set again keeps when it was made.
			made.set(line.id, first === undefined ? line : { ...line, at: first.at });
		} else if (line.row === "runner-ended") {
			const at = Date.parse(line.at);
			ended.set(line.id, Math.min(at, ended.get(line.id) ?? at));
		} else if (line.row === "runner-stopped" || line.row === "runner-started") {
			const each = turns.get(line.id) ?? [];
			each.push({
				stopped: line.row === "runner-stopped",
				at: Date.parse(line.at),
			});
			turns.set(line.id, each);
		} else {
			jobs.push(line);
		}
	}
	const lives = [...made.values()].map((row) => {
		const from = Date.parse(row.at);
		const ending = ended.get(row.id) ?? null;
		const until = ending === null ? null : Math.max(from, ending);
		return {
			row,
			life: { id: row.id, from, until },
			spans: spansOf(row, from, until, turns.get(row.id) ?? []),
		};
	});
	const runs = jobs.map((job) => ({
		conversation: job.id,
		project: job.project,
		task: job.task,
		worker: job.runner,
		from: Date.parse(job.at),
		until: job.until === null ? null : Date.parse(job.until),
	}));
	return { lives, runs, jobs, bills };
}

/**
 * Who the runners' cost from `since` to `until` (epoch ms) went to, by
 * project and task, the most first, counted per job as the Billing page
 * counts it. `running` are the jobs running now.
 */
export function runnerShares(
	lines: readonly (SpendEntry | RunnerRow)[],
	now: number,
	running: readonly RunnerJobRow[],
	since: number,
	until: number,
): SpendShare[] {
	const { lives, runs } = readRows(lines, running);
	return splitSpend(
		lives.flatMap(({ spans }) => spans),
		runs,
		since,
		Math.min(until, now),
	);
}

/** A stretch of one runner's life at one price: running, or stopped and kept. */
interface RunnerSpan {
	id: string;
	stopped: boolean;
	dollarsPerHour: number;
	from: number;
	until: number | null;
}

/**
 * Runner `row`'s life from `from` to `until` cut where it stopped and
 * started again, as `turns` say, each stretch at its price: a stop or start
 * that changes nothing, or falls outside its life, is passed over.
 */
function spansOf(
	row: RunnerMadeRow,
	from: number,
	until: number | null,
	turns: readonly { stopped: boolean; at: number }[],
): RunnerSpan[] {
	const spans: RunnerSpan[] = [];
	let stopped = false;
	let since = from;
	const close = (at: number | null) => {
		if (at === null || at > since) {
			spans.push({
				id: row.id,
				stopped,
				dollarsPerHour: stopped
					? (row.stoppedDollarsPerHour ?? 0)
					: row.dollarsPerHour,
				from: since,
				until: at,
			});
		}
	};
	for (const turn of [...turns].sort((one, other) => one.at - other.at)) {
		if (
			turn.stopped === stopped ||
			turn.at < from ||
			(until !== null && turn.at >= until)
		) {
			continue;
		}
		close(turn.at);
		stopped = turn.stopped;
		since = turn.at;
	}
	close(until);
	return spans;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

function dayOf(at: number): string {
	return new Date(at).toISOString().slice(0, 10);
}

/** The start of the UTC month after the one starting at `since`. */
function nextMonth(since: number): number {
	const date = new Date(since);
	date.setUTCMonth(date.getUTCMonth() + 1);
	return date.getTime();
}
