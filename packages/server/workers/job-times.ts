import type { RunnerJobRow } from "../spend";
import type { HeldJob } from "./job-pool";

/** How many of a command's last runs its expected length is the median of. */
export const JOB_TIMES_KEPT = 20;

/**
 * How long heavy jobs take, learned from those runners ran: a job is
 * expected to take the median of the last runs of the same command in its
 * project, else of any in its project, so a busy runner's end can be
 * weighed against making another.
 */
export class JobTimes {
	/** The last lengths in milliseconds, newest last, by project and command. */
	private readonly byWhat = new Map<string, number[]>();
	private readonly byProject = new Map<string, number[]>();

	/** Learns from the ledger's rows of jobs that ended, oldest first. */
	learn(rows: RunnerJobRow[]): void {
		for (const row of rows) {
			if (row.until !== null) {
				this.ran(
					row,
					new Date(row.until).getTime() - new Date(row.at).getTime(),
				);
			}
		}
	}

	/** Learns from `job`, which just gave its place up. */
	ended(job: HeldJob & { until: number }): void {
		this.ran(job, job.until - job.since);
	}

	/** When `job` is expected to end, epoch milliseconds; null with nothing to go by. */
	end(job: HeldJob): number | null {
		const lengths =
			this.byWhat.get(key(job)) ?? this.byProject.get(job.project);
		return lengths === undefined ? null : job.since + median(lengths);
	}

	private ran(job: { project: string; what: string }, ms: number): void {
		if (!Number.isFinite(ms) || ms < 0) {
			return;
		}
		keep(this.byWhat, key(job), ms);
		keep(this.byProject, job.project, ms);
	}
}

const key = (job: { project: string; what: string }): string =>
	`${job.project}\n${job.what}`;

const keep = (map: Map<string, number[]>, at: string, ms: number): void => {
	const lengths = map.get(at) ?? [];
	lengths.push(ms);
	lengths.splice(0, Math.max(0, lengths.length - JOB_TIMES_KEPT));
	map.set(at, lengths);
};

const median = (lengths: number[]): number => {
	const sorted = [...lengths].sort((one, other) => one - other);
	return sorted[Math.floor(sorted.length / 2)] as number;
};
