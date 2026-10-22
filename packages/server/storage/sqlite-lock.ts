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
 * A mutex between processes, held by a row in the database: taken by the
 * insert that finds none there, and stolen from a holder on this host that
 * died, or on another that fell silent for `stalenessMs`.
 */
export class SqliteLock implements Lock {
	constructor(
		readonly key: string,
		private readonly deps: {
			db: SqliteDb;
			ps: Ps;
			log?: Logger;
			stalenessMs: number;
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
			.query("DELETE FROM locks WHERE key = ? AND pid = ? AND hostname = ?")
			.run(this.key, ps.pid, ps.hostname);
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
		const { ps, stalenessMs } = this.deps;
		if (holder.hostname === ps.hostname) {
			return !ps.alive(holder.pid);
		}
		return Date.now() - holder.at > stalenessMs;
	}
}
