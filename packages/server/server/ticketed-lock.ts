import { aborts } from "core/abort";
import type { Logger } from "core/log";
import type { Fs, Lock, Ps } from "core/system";
import { Duration, sleep } from "core/time";

/**
 * A lock whose waiters are told their place in line as they wait: 1 is next
 * for the lock once its holder lets go. A waiter that stops wanting it
 * aborts `signal`, and its `acquire` rejects with the signal's reason unless
 * it already holds the lock.
 */
export interface PlacedLock extends Lock {
	// vet-ignore objects-over-callbacks: `onPlace` runs within the call, reporting the wait's progress, as `MergeGate.reserve` takes its `onQueued`.
	acquire(
		onPlace?: (place: number) => void | Promise<void>,
		signal?: AbortSignal,
		opts?: PlacedAcquireOptions,
	): Promise<void>;
	/**
	 * Starts over the time a holder may keep the lock, where the lock caps
	 * it: a holder that begins another bounded step of work calls it, with
	 * the step's bound as `holdMs` when it is longer than the lock's own.
	 */
	renew?(holdMs?: number): void;
	/**
	 * Asks the waiter that named itself `task` in its `acquire` options to
	 * move to the front of the line, ahead of every waiter but the one
	 * already next. Does nothing for a task not waiting.
	 */
	bump?(task: string): Promise<void>;
}

export interface PlacedAcquireOptions {
	/**
	 * Waits ahead of every waiter that did not ask to, behind those that did
	 * and the one already next, as a merge does once it has resolved a
	 * conflict, so its resolution does not go stale behind the whole line.
	 */
	ahead?: boolean;
	/** Names the waiter, so a `bump` for it finds it. */
	task?: string;
}

/**
 * Serves `inner`, a lock with no order of its own, to its waiters across
 * processes first come, first served, each told its place in line as it
 * waits. Wrap a `FileLock` in one, with a `dir` for its tickets beside the
 * lock, and take and release it as the lock itself.
 */
export class TicketedLock implements PlacedLock {
	// Each waiter leaves a ticket in `dir`, and only the one with the oldest
	// live ticket asks `inner` for the lock, which otherwise goes to whichever
	// waiter polls first. A ticket whose process is gone is dropped by the
	// next waiter to look, so a killed waiter holds nobody up. The pid alone
	// decides, whatever hostname the ticket was written under: every waiter
	// runs on this machine, whose name macOS changes with the network.
	private readonly fs: Fs;
	private readonly ps: Ps;
	private readonly log: Logger;
	private readonly pollMs: number;
	private readonly stalenessMs: number;
	/** Where a `bump` leaves its request for the waiter, beside the tickets so they never count it. */
	private readonly bumps: string;
	/** Tells one waiter's tickets apart within a process, as tests make several. */
	private issued = 0;

	constructor(
		private readonly inner: Lock,
		private readonly dir: string,
		opts: TicketedLockOptions,
	) {
		this.fs = opts.fs;
		this.ps = opts.ps;
		this.log = opts.log;
		this.pollMs = opts.pollMs ?? 1000;
		this.stalenessMs = opts.stalenessMs ?? 60_000;
		this.bumps = `${dir}-bumps`;
	}

	/**
	 * Waits for every ticket ahead to go, telling `onPlace` this waiter's
	 * place each time it changes, then takes `inner`. The ticket stays while
	 * `inner` is taken, so a later waiter keeps its place behind this one,
	 * and goes once the lock is had. Aborting `signal` gives the place up:
	 * the ticket goes and the call rejects with the signal's reason, unless
	 * the lock was had already.
	 */
	// vet-ignore objects-over-callbacks: `onPlace` runs within the call, reporting the wait's progress, as `MergeGate.reserve` takes its `onQueued`.
	async acquire(
		onPlace?: (place: number) => void | Promise<void>,
		signal?: AbortSignal,
		opts: PlacedAcquireOptions = {},
	): Promise<void> {
		let ticket = await this.issue(opts.ahead === true ? AHEAD : "");
		try {
			let place: number | null = null;
			for (;;) {
				signal?.throwIfAborted();
				if (!ticket.startsWith(BUMPED) && (await this.takeBump(opts.task))) {
					// Reissued ahead of the rest, then the old one goes, so the
					// waiter is never without a ticket.
					const old = ticket;
					ticket = await this.issue(BUMPED);
					await this.fs.rm(`${this.dir}/${old}`, { force: true });
					place = null;
				}
				const ahead = await this.ahead(ticket);
				if (ahead + 1 !== place) {
					place = ahead + 1;
					await onPlace?.(place);
				}
				if (ahead === 0) {
					// Seen by a ticket `ahead` issued from now on, which waits behind it.
					await this.fs.write(
						`${this.dir}/${ticket}`,
						JSON.stringify({ ...this.holder(), next: true }),
					);
					break;
				}
				await sleep(Duration.ms(this.pollMs));
			}
			signal?.throwIfAborted();
			const taking = this.inner.acquire();
			if (signal === undefined) {
				await taking;
				return;
			}
			try {
				await aborts.race(signal, taking);
			} catch (error) {
				// `inner` cannot be told to stop asking: a lock it gets after this
				// goes straight back, so the next waiter has it a poll later.
				void taking.then(
					() => this.inner.release(),
					() => {},
				);
				throw error;
			}
		} finally {
			await this.fs.rm(`${this.dir}/${ticket}`, { force: true });
		}
	}

	async bump(task: string): Promise<void> {
		await this.fs.mkdir(this.bumps, { recursive: true });
		await this.fs.write(`${this.bumps}/${encodeURIComponent(task)}`, "");
	}

	async release(): Promise<void> {
		await this.inner.release();
	}

	async releaseIfOurs(): Promise<void> {
		await this.inner.releaseIfOurs();
	}

	/**
	 * Leaves a ticket named so that names sort in the order they were issued:
	 * the time, then the process, then a count within it. One `ahead` starts
	 * with `AHEAD`, which sorts before every digit, and one bumped with `BUMPED`, before that.
	 */
	private async issue(prefix: string): Promise<string> {
		await this.fs.mkdir(this.dir, { recursive: true });
		const at = new Date();
		const name = `${prefix}${String(at.getTime()).padStart(15, "0")}-${this.ps.pid}-${this.issued++}`;
		await this.fs.write(`${this.dir}/${name}`, JSON.stringify(this.holder()));
		return name;
	}

	/** Whether a bump was asked for `task` since the last look, which it then forgets. */
	private async takeBump(task: string | undefined): Promise<boolean> {
		if (task === undefined) {
			return false;
		}
		const path = `${this.bumps}/${encodeURIComponent(task)}`;
		if (
			!(await this.fs.read(path).then(
				() => true,
				() => false,
			))
		) {
			return false;
		}
		await this.fs.rm(path, { force: true });
		return true;
	}

	private holder(): { pid: number; hostname: string; at: string } {
		return {
			pid: this.ps.pid,
			hostname: this.ps.hostname,
			at: new Date().toISOString(),
		};
	}

	/** Whether `name`'s waiter is past the line, asking `inner` for the lock. */
	private async isNext(name: string): Promise<boolean> {
		const raw = await this.fs.read(`${this.dir}/${name}`).catch(() => null);
		try {
			return raw !== null && JSON.parse(raw).next === true;
		} catch {
			return false;
		}
	}

	/**
	 * How many live tickets were issued before `ticket`, dropping the dead
	 * ones it meets. One `AHEAD` counts a plain ticket marked `next` too,
	 * whose waiter is asking `inner` and no longer looks at the line.
	 */
	private async ahead(ticket: string): Promise<number> {
		const names = await this.fs.readdir(this.dir).catch(() => []);
		let ahead = 0;
		for (const name of names) {
			if (
				name >= ticket &&
				!(ticket.startsWith(AHEAD) && (await this.isNext(name)))
			) {
				continue;
			}
			const stale = await this.isStale(name);
			if (stale !== null) {
				this.log.error(
					`dropping premerge ticket ${name} of pid ${stale.pid}: ${stale.why}`,
				);
				await this.fs.rm(`${this.dir}/${name}`, { force: true });
				continue;
			}
			ahead++;
		}
		return ahead;
	}

	/** Why a ticket's waiter is taken to be gone; null for one still waiting. */
	private async isStale(
		name: string,
	): Promise<{ pid: number | string; why: string } | null> {
		const raw = await this.fs.read(`${this.dir}/${name}`).catch(() => null);
		let holder: { pid: number; hostname: string; at: string } | null = null;
		try {
			holder = raw === null ? null : JSON.parse(raw);
		} catch {
			holder = null;
		}
		if (holder === null) {
			// Still being written, most likely: only one unreadable for long is gone.
			return Date.now() - Number(name.replace(/^!+/, "").split("-")[0]) >
				this.stalenessMs
				? { pid: "?", why: "it cannot be read" }
				: null;
		}
		return this.ps.alive(holder.pid)
			? null
			: { pid: holder.pid, why: "the process is gone" };
	}
}

/** Starts the name of a ticket that waits ahead of the plain ones. */
const AHEAD = "!";

/** Starts the name of a ticket bumped to the front, which sorts before every `AHEAD` one. */
const BUMPED = "!!";

export interface TicketedLockOptions {
	fs: Fs;
	ps: Ps;
	log: Logger;
	/** How often a waiter looks at the line again. */
	pollMs?: number;
	/** How long a ticket that cannot be read may wait before it is dropped. */
	stalenessMs?: number;
}
