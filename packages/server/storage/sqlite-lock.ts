import type { Logger } from "webappwiz/log";
import type { Lock, Ps } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import type { SqliteDb } from "./sqlite-db";

/** Who holds a lock, as its row records. */
interface Holder {
	pid: number;
	hostname: string;
	at: number;
}

/**
 * A mutex between the processes on this machine that share a database:
 * `acquire` waits until no live process holds it, taking it from one that
 * died, and `release` gives it up.
 */
export class SqliteLock implements Lock {
	constructor(
		readonly key: string,
		private readonly deps: {
			db: SqliteDb;
			ps: Ps;
			log?: Logger;
			pollMs?: number;
		},
	) {}

	async acquire(): Promise<void> {
		const { db, ps, log, pollMs = 100 } = this.deps;
		let sleepMs = 5;
		for (let waited = false; ; waited = true) {
			const { changes } = db.db
				.query(
					"INSERT OR IGNORE INTO locks (key, pid, hostname, at) VALUES (?, ?, ?, ?)",
				)
				.run(this.key, ps.pid, ps.hostname, Date.now());
			if (changes > 0) {
				if (waited) {
					log?.error(`acquired ${this.key} after waiting`);
				}
				return;
			}
			const holder = this.holder();
			if (holder !== null && this.isStale(holder)) {
				log?.error(`stealing stale lock ${this.key}`);
				this.drop(holder);
				continue;
			}
			await sleep(Duration.ms(sleepMs));
			sleepMs = Math.min(sleepMs * 2, pollMs);
		}
	}

	// scry-ignore resources-are-disposable: `Lock` names it release, as every lock splates takes does.
	async release(): Promise<void> {
		const { db, ps } = this.deps;
		db.db
			.query("DELETE FROM locks WHERE key = ? AND pid = ?")
			.run(this.key, ps.pid);
	}

	async releaseIfOurs(): Promise<void> {
		await this.release();
	}

	private holder(): Holder | null {
		return this.deps.db.db
			.query<Holder, [string]>(
				"SELECT pid, hostname, at FROM locks WHERE key = ?",
			)
			.get(this.key);
	}

	/** Removes `holder`'s row, and not one another took since it was read. */
	private drop(holder: Holder): void {
		this.deps.db.db
			.query(
				"DELETE FROM locks WHERE key = ? AND pid = ? AND hostname = ? AND at = ?",
			)
			.run(this.key, holder.pid, holder.hostname, holder.at);
	}

	private isStale(holder: Holder): boolean {
		// The pid alone decides, whatever hostname the row was written under:
		// every holder runs on this machine, whose name macOS changes with the
		// network.
		return !this.deps.ps.alive(holder.pid);
	}
}
