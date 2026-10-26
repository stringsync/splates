import { availableParallelism } from "node:os";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { PREMERGE_TIMEOUT_MS, premergeLockOfMachine } from "../server/premerge";
import type { PlacedLock } from "../server/ticketed-lock";
import { JobClient } from "./client";
import { type JobSpec, Priority } from "./job";
import { JobLock } from "./lock";
import { SUITE } from "./pools";

/**
 * A merge gate's job: the suite's tree, and between half the cores and all
 * but two of them, as the gate sized its workers before, at high priority
 * for as long as a gate may run.
 */
export function gateJob({
	what,
	task,
	cores = availableParallelism(),
	timeoutMs = PREMERGE_TIMEOUT_MS,
}: {
	what: string;
	task?: string;
	cores?: number;
	timeoutMs?: number;
}): JobSpec {
	const half = Math.max(1, Math.floor(cores / 2));
	return {
		what,
		...(task === undefined ? {} : { task }),
		priority: Priority.high,
		request: {
			resources: {
				cpus: { min: half, max: Math.max(half, cores - 2) },
				[SUITE]: 1,
			},
			walltime: Duration.ms(timeoutMs),
		},
	};
}

/**
 * What a merge's gate, or a `dev premerge` by hand, holds while the whole
 * suite runs: its job in the server's scheduler, or, with no server to ask,
 * the machine's premerge lock itself.
 */
export function gateLockOfMachine({
	fs,
	ps,
	log,
	what,
	cores,
	timeoutMs,
}: {
	fs: Fs;
	ps: Ps;
	log: Logger;
	what: string;
	cores?: number;
	timeoutMs?: number;
}): PlacedLock & { allocation: Record<string, number> | null } {
	const fallback = premergeLockOfMachine({ fs, ps, log });
	const client = JobClient.of(ps, log);
	const spec = gateJob({
		what,
		...(cores === undefined ? {} : { cores }),
		...(timeoutMs === undefined ? {} : { timeoutMs }),
	});
	return new JobLock(
		client ?? {
			submit: async () => {
				throw new Error("SPLATES_DEV names no server");
			},
		},
		fallback,
		spec,
		log,
	);
}
