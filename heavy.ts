import type { Logger } from "webappwiz/log";
import { type Fs, HeavyJobs, type Ps } from "webappwiz/system";
import { arborHome } from "./roster";
import { MACHINE_HOME } from "./slots";

/**
 * How many heavy jobs run at once on a machine when `ARBOR_HEAVY_JOBS` says
 * nothing. One `bin/wiz dev test` takes about 7 cores and 7.3 GB, so two
 * bound the spike near 15 GB on a 64 GB Mac running two dozen sessions.
 */
export const HEAVY_JOBS_DEFAULT = 2;

/** Sets the cap for the machine, read by every arbor that takes a slot. */
export const HEAVY_JOBS = "ARBOR_HEAVY_JOBS";

/**
 * What runs in a slot finds this in its environment: a heavy job it starts,
 * such as the test run of a `preMerge` hook, runs in that slot too.
 */
export const HEAVY_HELD = "ARBOR_HEAVY";

/**
 * This machine's heavy-job slots, under the home `arbor dev --slot` names its
 * servers' machine by, else `ARBOR_HOME`, so every server on one machine
 * shares one cap; capped by `ARBOR_HEAVY_JOBS`. `wiz dev test` finds them
 * the same way, in `packages/wiz/heavy.ts`.
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
	return HeavyJobs.under(ps.env(MACHINE_HOME) ?? arborHome(ps), {
		fs,
		ps,
		log,
		cap: capOf(ps.env(HEAVY_JOBS)),
		held: HEAVY_HELD,
	});
}

/** The cap `ARBOR_HEAVY_JOBS` names, or the default for none or nonsense. */
export function capOf(value: string | undefined): number {
	const cap = Number(value);
	return Number.isInteger(cap) && cap > 0 ? cap : HEAVY_JOBS_DEFAULT;
}
