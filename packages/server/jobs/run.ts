import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { BESIDE_GATE_NICE } from "../server/premerge";
import {
	type JobHandle,
	type JobSpec,
	type JobSubmitter,
	Priority,
} from "./job";

/** How long a command run as a job may take when it says nothing else. */
export const RUN_WALLTIME = Duration.mins(10);
/** The cores a command run as a job asks for when it says nothing else. */
export const RUN_CPUS = 2;
/** The exit code of a command stopped at its walltime, as `timeout` gives. */
export const EXPIRED_EXIT = 124;

export interface RunOptions {
	/** The command and its arguments, run as given. */
	argv: string[];
	cpus?: number;
	/** Megabytes; none asked for when left out. */
	memory?: number;
	walltime?: Duration;
	/** The scheduler to take a turn from; null runs at once, unscheduled. */
	submitter: JobSubmitter | null;
	log: Logger;
	ps: Ps;
}

/** `splates run`'s job: the command, small and low, for whoever runs it. */
export function runJob({
	argv,
	cpus = RUN_CPUS,
	memory,
	walltime = RUN_WALLTIME,
	ps,
}: Pick<RunOptions, "argv" | "cpus" | "memory" | "walltime" | "ps">): JobSpec {
	const task = ps.env("SPLATES_TASK");
	const conversation = ps.env("SPLATES_CONVERSATION");
	return {
		what: argv.join(" "),
		...(task === undefined ? {} : { task }),
		...(conversation === undefined ? {} : { conversation }),
		priority: Priority.low,
		request: {
			resources: { cpus, ...(memory === undefined ? {} : { mem: memory }) },
			walltime,
		},
	};
}

/**
 * Runs a command as a job of the machine's scheduler: waits its turn,
 * telling its place, runs it niced with stdio inherited and finishes the job after. Returns the command's
 * exit code, or `EXPIRED_EXIT` when it ran past its walltime. With no
 * scheduler to ask, or one lost along the way, the command runs unscheduled.
 */
export async function run(opts: RunOptions): Promise<number> {
	const { argv, submitter, log, ps } = opts;
	const spec = runJob(opts);
	let job: JobHandle | null = null;
	try {
		job = (await submitter?.submit(spec)) ?? null;
	} catch (error) {
		log.info(
			`no splates server schedules jobs (${error instanceof Error ? error.message : String(error)}): running at once`,
		);
	}
	try {
		for (;;) {
			if (job !== null && !(await started(job, log))) {
				// Lost while waiting.
				job = null;
			}
			const outcome = await execute(argv, job, ps);
			if (outcome !== "preempted") {
				return outcome;
			}
			log.info("a higher job took the machine: waiting to start over");
		}
	} finally {
		await job?.finish();
	}
}

/** Until the job may run, false when it is lost first. */
async function started(job: JobHandle, log: Logger): Promise<boolean> {
	if (job.allocation !== null) {
		return true;
	}
	const waiting = Promise.withResolvers<boolean>();
	const told = (place: number) =>
		log.info(place === 1 ? "next in line" : `${place} in line`);
	if (job.place !== null) {
		told(job.place);
	}
	const offs = [
		job.events.on("placed", told),
		job.events.on("started", () => waiting.resolve(true)),
		job.events.on("lost", () => waiting.resolve(false)),
	];
	try {
		return await waiting.promise;
	} finally {
		for (const off of offs) {
			off();
		}
	}
}

/** One go at the command under `job`; stopped when the job is preempted or expires. */
async function execute(
	argv: string[],
	job: JobHandle | null,
	ps: Ps,
): Promise<number | "preempted"> {
	const stop = new AbortController();
	let stopped: "preempted" | "expired" | null = null;
	const offs =
		job === null
			? []
			: [
					job.events.on("preempted", () => {
						stopped = "preempted";
						stop.abort();
					}),
					job.events.on("expired", () => {
						stopped = "expired";
						stop.abort();
					}),
				];
	try {
		const { exitCode } = await ps.spawn(
			["nice", "-n", String(BESIDE_GATE_NICE), ...argv],
			{ signal: stop.signal },
		);
		return exitCode;
	} catch (error) {
		if (stopped === null) {
			throw error;
		}
		return stopped === "preempted" ? "preempted" : EXPIRED_EXIT;
	} finally {
		for (const off of offs) {
			off();
		}
	}
}

/** A task's install: its hook, at normal priority, not to be stopped for another job. */
export function installJob(hook: string, task: string): JobSpec {
	return {
		what: hook,
		task,
		priority: Priority.normal,
		request: { resources: { cpus: RUN_CPUS }, walltime: RUN_WALLTIME },
	};
}
