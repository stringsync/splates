import { JobClient, type JobSpec } from "@stringsync/splates-server/jobs";
import { PREMERGE_HELD } from "@stringsync/splates-server/server";
import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";

/** What a scheduled run is handed: the cpus its job was given, and when to stop. */
export interface JobRun {
	/** The cpus the job was allocated; undefined when the run is unscheduled. */
	cpus: number | undefined;
	/** Aborts when the scheduler takes the machine back (preempted, expired). */
	signal: AbortSignal;
}

/**
 * Runs `run` once the machine's scheduler grants `spec` as a job, so the
 * person's other work and every other agent's share the machine fairly. A
 * requeue-able job a higher one preempts is stopped and runs again from the
 * start once it is granted again. With no server to ask (no `SPLATES_DEV`,
 * or one that does not answer), inside a merge's gate, which holds the
 * machine already, or when `unscheduled`, it runs at once.
 */
export async function scheduled<T>({
	ps,
	log,
	spec,
	unscheduled = false,
	run,
}: {
	ps: Ps;
	log: Logger;
	spec: JobSpec;
	/** Whether the caller holds the machine already, as `dev premerge` does. */
	unscheduled?: boolean;
	run: (granted: JobRun) => Promise<T>;
}): Promise<T> {
	const never = new AbortController().signal;
	const client =
		unscheduled || ps.env(PREMERGE_HELD) !== undefined
			? null
			: JobClient.of(ps, log);
	if (client === null) {
		return await run({ cpus: undefined, signal: never });
	}
	const conversation = ps.env("SPLATES_CONVERSATION");
	const job = await client
		.submit({
			...spec,
			...(conversation === undefined ? {} : { conversation }),
		})
		.catch((error: unknown) => {
			log.info(
				`no splates server schedules jobs (${error instanceof Error ? error.message : String(error)}): running at once`,
			);
			return null;
		});
	if (job === null) {
		return await run({ cpus: undefined, signal: never });
	}
	try {
		let told = 0;
		for (;;) {
			if (job.allocation === null) {
				const waiting: (() => void)[] = [];
				const outcome = await new Promise<"started" | "lost">((resolve) => {
					waiting.push(
						job.events.on("placed", (place) => {
							if (place !== told) {
								told = place;
								log.info(
									`${spec.what}: ${place === 1 ? "next" : `${place} in line`} for the machine`,
								);
							}
						}),
						job.events.on("started", () => resolve("started")),
						job.events.on("lost", () => resolve("lost")),
					);
					// Started before anyone listened, as the submission was looked at at once.
					if (job.allocation !== null) {
						resolve("started");
					}
				}).finally(() => {
					for (const off of waiting) {
						off();
					}
				});
				if (outcome === "lost") {
					log.info("the splates server went away: running at once");
					return await run({ cpus: undefined, signal: never });
				}
			}
			const stop = new AbortController();
			let taken: "preempted" | "expired" | null = null;
			const offs = [
				job.events.on("preempted", () => {
					taken = "preempted";
					stop.abort();
				}),
				job.events.on("expired", () => {
					taken = "expired";
					stop.abort();
				}),
			];
			try {
				return await run({
					cpus: job.allocation?.cpus,
					signal: stop.signal,
				});
			} catch (error) {
				if (taken === "expired") {
					throw new Error(
						`${spec.what} ran past its walltime, so it was stopped`,
					);
				}
				if (taken !== "preempted") {
					throw error;
				}
				log.info(
					`${spec.what}: a merge gate took the machine, so it waits and starts over`,
				);
			} finally {
				for (const off of offs) {
					off();
				}
			}
		}
	} finally {
		await job.finish();
	}
}
