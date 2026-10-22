import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import { refuse } from "../server/shared";
import { type DirectBoardView, DirectReport } from "./direct-report";
import type {
	DirectJobReport,
	DirectRunnerReport,
} from "./direct-runner-report";

/** How long a job still going may go unheard before it counts as gone: `splates run` reports one each minute. */
const JOB_UNHEARD = Duration.mins(3);

/** How long a job that ended stays listed. */
const ENDED_FOR = Duration.mins(15);

/** How long a runner may go unheard before it is left off: the reaper lists them every 11 minutes. */
const RUNNER_UNHEARD = Duration.mins(30);

/**
 * What `splates run` reports of the runners it makes for itself and the
 * jobs on them, kept in memory for the Runners page while the server runs.
 * `splates run` never needs it: it reports when a server answers, and the
 * cloud and the runners themselves hold the truth.
 */
export class DirectBoard {
	private readonly wall: WallClock;
	private readonly runners = new Map<
		string,
		{ report: DirectRunnerReport; heard: number }
	>();
	private readonly jobs = new Map<
		string,
		{ report: DirectJobReport; heard: number }
	>();

	constructor(opts: DirectBoardOptions = {}) {
		this.wall = opts.wall ?? new SystemWallClock();
	}

	/**
	 * `POST /api/runner-reports`: where a runner `splates run` made, or a job
	 * on one, stands, as it reports while a server is up.
	 */
	readonly post = async (request: Request): Promise<Response> => {
		const parsed = DirectReport.safeParse(
			await request.json().catch(() => null),
		);
		if (!parsed.success) {
			return refuse(400, "usage", "a runner report is runners and a job");
		}
		this.report(parsed.data);
		return new Response(null, { status: 204 });
	};

	/** Takes in what `splates run` reported. */
	report(report: DirectReport): void {
		const now = this.wall.now();
		for (const runner of report.runners ?? []) {
			if (runner.state === "deleted") {
				this.runners.delete(runner.id);
			} else {
				this.runners.set(runner.id, { report: runner, heard: now });
			}
		}
		if (report.job !== undefined) {
			this.jobs.set(report.job.id, { report: report.job, heard: now });
		}
	}

	/** Each runner with its jobs, newest first, and the jobs with none yet. */
	view(): DirectBoardView {
		const now = this.wall.now();
		for (const [id, { heard }] of this.runners) {
			if (now - heard > RUNNER_UNHEARD.ms) {
				this.runners.delete(id);
			}
		}
		for (const [id, { report, heard }] of this.jobs) {
			const ended = report.phase === "done" || report.phase === "failed";
			if (now - heard > (ended ? ENDED_FOR : JOB_UNHEARD).ms) {
				this.jobs.delete(id);
			}
		}
		const jobs = [...this.jobs.values()]
			.map(({ report }) => report)
			.sort((one, other) => other.since - one.since);
		return {
			runners: [...this.runners.values()]
				.map(({ report }) => ({
					...report,
					jobs: jobs.filter((job) => job.runner === report.id),
				}))
				.sort((one, other) => other.createdAt - one.createdAt),
			unplaced: jobs.filter(
				(job) => job.runner === null || !this.runners.has(job.runner),
			),
		};
	}
}

/** What a `DirectBoard` runs on. */
export interface DirectBoardOptions {
	wall?: WallClock;
}
