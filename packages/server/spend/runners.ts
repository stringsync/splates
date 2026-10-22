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
	/** The provider whose bill it is on, as `digitalocean`; null when no bill is pulled for it. */
	provider: string | null;
	/** What it costs an hour, in US dollars, as the provider's API said when it was made. */
	dollarsPerHour: number;
	/** When it was asked for, as an ISO timestamp. */
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
export type RunnerRow = RunnerMadeRow | RunnerEndedRow | RunnerJobRow;

/** One runner's life, as the Billing page lists it. */
export interface RunnerLife {
	id: string;
	/** The provider's own name for its machine type. */
	type: string;
	/** Its CPUs and memory in GB, null where the ledger does not say. */
	size: { cpus: number; memory: number } | null;
	provider: string | null;
	dollarsPerHour: number;
	/** When it was made, and destroyed, as ISO timestamps; `until` is null while it is up. */
	from: string;
	until: string | null;
	/** Hours it was up, to now for one up now. */
	hours: number;
	/** What it cost, an estimate at `dollarsPerHour`. */
	dollars: number;
	/** How many jobs it ran, those running now included. */
	jobs: number;
}

/** Runner-hours and their estimated dollars in one day or month. */
export interface RunnerPeriod {
	/** Its first day, `2026-10-21`, or the 1st for a month, in UTC as the ledger's days are. */
	period: string;
	hours: number;
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
		.map(({ row, life }) => {
			const hours = ((life.until ?? now) - life.from) / HOUR;
			return {
				id: row.id,
				type: row.type,
				size:
					row.cpus === undefined || row.memory === undefined
						? null
						: { cpus: row.cpus, memory: row.memory },
				provider: row.provider,
				dollarsPerHour: row.dollarsPerHour,
				from: row.at,
				until: life.until === null ? null : new Date(life.until).toISOString(),
				hours,
				dollars: hours * row.dollarsPerHour,
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
		for (const { life } of lives) {
			const ms =
				Math.min(life.until ?? now, until, now) - Math.max(life.from, since);
			if (ms > 0) {
				hours += ms / HOUR;
				dollars += (ms / HOUR) * life.dollarsPerHour;
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
			lives.map(({ life }) => life),
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
		} else {
			jobs.push(line);
		}
	}
	const lives = [...made.values()].map((row) => {
		const from = Date.parse(row.at);
		const until = ended.get(row.id) ?? null;
		return {
			row,
			life: {
				id: row.id,
				dollarsPerHour: row.dollarsPerHour,
				from,
				until: until === null ? null : Math.max(from, until),
			},
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
		lives.map(({ life }) => life),
		runs,
		since,
		Math.min(until, now),
	);
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
