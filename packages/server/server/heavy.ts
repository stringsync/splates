import type { Logger } from "webappwiz/log";
import { type Fs, HeavyJobs, type Ps } from "webappwiz/system";
import { splatesHome } from "../models";
import { MACHINE_HOME } from "../ports";

/**
 * How many heavy jobs run at once on a machine when `SPLATES_HEAVY_JOBS` says
 * nothing. One `splates dev test` takes about 7 cores and 7.3 GB, so two
 * bound the spike near 15 GB on a 64 GB Mac running two dozen sessions.
 */
export const HEAVY_JOBS_DEFAULT = 2;

/** Sets the cap for the machine, read by every splates that takes a slot. */
export const HEAVY_JOBS = "SPLATES_HEAVY_JOBS";

/**
 * What runs in a slot finds this in its environment: a heavy job it starts,
 * such as the test run of a `preMerge` hook, runs in that slot too.
 */
export const HEAVY_HELD = "SPLATES_HEAVY";

/**
 * This machine's heavy-job slots, under the home `splates server --slot` names its
 * servers' machine by, else `SPLATES_HOME`, so every server on one machine
 * shares one cap; capped by `SPLATES_HEAVY_JOBS`. `splates dev test` takes one
 * here too.
 */
export function heavyJobsOfMachine({
	fs,
	ps,
	log,
}: {
	fs: Fs;
	ps: Ps;
	log: Logger;
}): HeavyJobs {
	return HeavyJobs.under(ps.env(MACHINE_HOME) ?? splatesHome(ps), {
		fs,
		ps,
		log,
		cap: capOf(ps.env(HEAVY_JOBS)),
		held: HEAVY_HELD,
	});
}

/** The cap `SPLATES_HEAVY_JOBS` names, or the default for none or nonsense. */
export function capOf(value: string | undefined): number {
	const cap = Number(value);
	return Number.isInteger(cap) && cap > 0 ? cap : HEAVY_JOBS_DEFAULT;
}
