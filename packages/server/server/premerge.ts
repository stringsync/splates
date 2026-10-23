import type { Logger } from "webappwiz/log";
import { FileLock, type Fs, type Lock, type Ps } from "webappwiz/system";
import { splatesHome } from "../models";
import { MACHINE_HOME } from "../ports";

/**
 * Set for what a merge's gate runs, which holds the premerge lock already:
 * a `splates dev premerge` it runs goes ahead without waiting for it.
 */
export const PREMERGE_HELD = "SPLATES_PREMERGE";

/**
 * Set for a merge's gate to the test files that failed recent gates, one
 * path a line, which `dev premerge` runs before the whole suite.
 */
export const RECENT_FAILED_FILES = "SPLATES_RECENT_FAILED_FILES";

/**
 * How long a merge's gate may run before it is killed. The whole suite takes
 * well under a minute alone, so a gate this long has hung, and the agent
 * merges again.
 */
export const PREMERGE_TIMEOUT_MS = 3 * 60 * 1000;

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
 * suite runs one at a time on this machine. A holder keeps it at most
 * `PREMERGE_HOLD_MS`.
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
