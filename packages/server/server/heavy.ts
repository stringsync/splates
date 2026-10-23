import type { Logger } from "webappwiz/log";
import {
	FileLock,
	type Fs,
	HeavyJobs,
	type Lock,
	type Ps,
} from "webappwiz/system";
import { splatesHome } from "../models";
import { MACHINE_HOME } from "../ports";

/**
 * How many heavy jobs run at once on a machine when `SPLATES_HEAVY_JOBS` says
 * nothing. Two test runs heat the host too much while the person works,
 * so the merge gate fallback and other local heavy work run one at a time.
 */
export const HEAVY_JOBS_DEFAULT = 1;

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

/**
 * How long one holder may keep the premerge lock before it is let go of: a
 * gate that hangs, or a suite that never ends, must not wedge every other
 * merge. Far above a normal suite run.
 */
export const PREMERGE_HOLD_MS = 3 * 60 * 1000;

/**
 * A lock that lets itself go after `holdMs`, logging it, so a live holder
 * that never finishes cannot keep it forever. The holder's own `release`
 * after that does nothing.
 */
export class TimedLock implements Lock {
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly inner: Lock,
		private readonly holdMs: number,
		private readonly log: Logger,
	) {}

	async acquire(): Promise<void> {
		await this.inner.acquire();
		this.#timer = setTimeout(() => {
			this.#timer = null;
			this.log.error(
				`premerge lock held over ${Math.round(this.holdMs / 60000)} minutes: letting it go`,
			);
			void this.inner.release();
		}, this.holdMs);
		this.#timer.unref();
	}

	// scry-ignore resources-are-disposable: `Lock` names it release, as every lock splates takes does.
	async release(): Promise<void> {
		this.#stop();
		await this.inner.release();
	}

	async releaseIfOurs(): Promise<void> {
		this.#stop();
		await this.inner.releaseIfOurs();
	}

	#stop(): void {
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
	}
}

/**
 * The machine's one premerge: every task's merge gate, and a `splates dev
 * premerge` run by hand, holds it while the whole suite runs, so the full
 * suite runs one at a time on this machine whatever the heavy-job cap. A
 * holder keeps it at most `PREMERGE_HOLD_MS`.
 */
export function premergeLockOfMachine({
	fs,
	ps,
	log,
	holdMs = PREMERGE_HOLD_MS,
}: {
	fs: Fs;
	ps: Ps;
	log: Logger;
	holdMs?: number;
}): Lock {
	return new TimedLock(
		new FileLock(`${ps.env(MACHINE_HOME) ?? splatesHome(ps)}/premerge.lock`, {
			fs,
			ps,
			log,
		}),
		holdMs,
		log,
	);
}
