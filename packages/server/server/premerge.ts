import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { Logger } from "webappwiz/log";
import { FileLock, type Fs, type Ps } from "webappwiz/system";
import { splatesHome } from "../models";
import { MACHINE_HOME } from "../ports";
import { type PlacedLock, TicketedLock } from "./ticketed-lock";

/**
 * Set for what a merge's gate runs, which holds the premerge lock already:
 * a `splates dev premerge` it runs goes ahead without waiting for it.
 */
export const PREMERGE_HELD = "SPLATES_PREMERGE";

/** The commit the `preLock` checks passed on, set for the gate's `dev premerge`. */
export const CHECKED_COMMIT = "SPLATES_CHECKED";

/**
 * The nice for anything an agent runs beside a merge gate that is not the
 * gate, so the gate keeps the CPU: pass it to `nice -n` or `os.setPriority`.
 */
// The gate runs in the agent's own `splates merge`, so it cannot be raised;
// what runs beside it is lowered instead. Measured on a Mac with the cores
// oversubscribed, nice 10 gets about half the share of nice 0 and nice 19
// hardly less, while on Linux nice 19 would all but stop the agent's run.
export const BESIDE_GATE_NICE = 10;

/**
 * Set for a merge's gate to the test files that failed recent gates, one
 * path a line, which `dev premerge` runs before the whole suite.
 */
export const RECENT_FAILED_FILES = "SPLATES_RECENT_FAILED_FILES";

/**
 * Set for a merge's gate to a file its command may append the phases it
 * timed to, one `{"phase": "<name>", "ms": <n>}` line each, which the merge's
 * log entry keeps as its `gate`.
 */
export const GATE_PHASES = "SPLATES_GATE_PHASES";

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
 * that never finishes cannot keep it forever; a holder that `renew`s it, as
 * a merge does at each gate run, has `holdMs` again from then. The holder's
 * own `release` after that does nothing. The wait for the lock passes
 * through to `inner`, the place in line it tells and the signal included.
 */
export class TimedLock implements PlacedLock {
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly inner: PlacedLock,
		private readonly holdMs: number,
		private readonly log: Logger,
	) {}

	async acquire(
		onPlace?: (place: number) => void | Promise<void>,
		signal?: AbortSignal,
	): Promise<void> {
		await this.inner.acquire(onPlace, signal);
		this.#hold();
	}

	renew(): void {
		if (this.#timer !== null) {
			this.#stop();
			this.#hold();
		}
	}

	#hold(): void {
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
 * A project's one premerge: every task's merge gate in that project, and a
 * `splates dev premerge` run by hand there, holds it while the whole suite
 * runs, so a project's full suite runs one at a time. Projects take theirs
 * apart, since they cannot stomp on each other's checkouts. Waiters take it
 * in the order they asked, told their place in line meanwhile, and a holder
 * keeps it at most `PREMERGE_HOLD_MS`. `root` is the project's main tree.
 */
export function premergeLockOfProject({
	fs,
	ps,
	log,
	root,
	holdMs = PREMERGE_HOLD_MS,
}: {
	fs: Fs;
	ps: Ps;
	log: Logger;
	root: string;
	holdMs?: number;
}): PlacedLock {
	const home = ps.env(MACHINE_HOME) ?? splatesHome(ps);
	const key = createHash("sha256").update(root).digest("hex").slice(0, 12);
	return new TimedLock(
		new TicketedLock(
			new FileLock(`${home}/premerge-${key}.lock`, { fs, ps, log }),
			`${home}/premerge-${key}.queue`,
			{ fs, ps, log },
		),
		holdMs,
		log,
	);
}

/** The main tree of the project `cwd` is in, whichever worktree that is. */
export async function projectRootOf(ps: Ps, cwd: string): Promise<string> {
	const { exitCode, stdout } = await ps.spawnCapture([
		"git",
		"-C",
		cwd,
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	if (exitCode !== 0) {
		throw new Error(`not a git repository: ${cwd}`);
	}
	return dirname(stdout.trim());
}
