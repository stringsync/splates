import { Database } from "bun:sqlite";
import { Disposer, type Resource } from "webappwiz/disposable";
import { Dispatcher } from "webappwiz/events";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import type { StorageChanges, Watch, WatchOptions } from "./storage";

export interface SqliteDbOptions {
	timer?: Timer;
	/** How often a watch looks for what another process wrote. */
	pollMs?: number;
}

/** What `SqliteDb.write` runs inside a transaction: the keys it changed, for the watches. */
export type Write = () => string[];

/**
 * The database a `SqliteStorage` and every view `within` it share. Run each
 * change through `write`, so the watches hear of it, and `dispose` the one
 * opened to close the file.
 */
export class SqliteDb implements Resource {
	// A write made here is told to this process's watches as it commits; one
	// made by another process is found by the poll, which reads the `changes`
	// table once the database's version moves.
	readonly db: Database;
	/** Which process's writes these are, so the poll skips what was told here already. */
	readonly token = crypto.randomUUID();
	private readonly watches = new Set<Watching>();
	private readonly timer: Timer;
	private readonly pollMs: number;
	private readonly open = new Disposer();
	private poll: Resource | null = null;
	/** The database's version as of the last poll, which only another connection's commit moves. */
	private version = 0;
	/** The last change seq a poll took in. */
	private seen = 0;
	private lastPruned = 0;

	constructor(
		readonly path: string,
		opts: SqliteDbOptions = {},
	) {
		this.timer = opts.timer ?? new SystemTimer();
		this.pollMs = opts.pollMs ?? 200;
		this.db = new Database(path, { create: true });
		this.open.adopt(this.db, (db) => db.close());
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec(SCHEMA);
	}

	/**
	 * Runs `write` as one transaction, records each key it changed for other
	 * processes' watches, and tells this process's at once.
	 */
	write(write: Write): void {
		const changed = this.db
			.transaction(() => {
				const keys = write();
				if (keys.length > 0) {
					const at = Date.now();
					const note = this.db.query(
						"INSERT INTO changes (key, by, at) VALUES (?, ?, ?)",
					);
					for (const key of keys) {
						note.run(key, this.token, at);
					}
					this.prune(at);
				}
				return keys;
			})
			.immediate();
		for (const key of changed) {
			this.tell(key);
		}
	}

	watch(root: string, at: string, opts: WatchOptions = {}): Watch {
		const watch: Watching = {
			at,
			root,
			recursive: opts.recursive ?? false,
			changes: new Dispatcher<StorageChanges>(),
		};
		if (this.watches.size === 0) {
			this.startPolling();
		}
		this.watches.add(watch);
		const watching = this.open.use({
			events: watch.changes.events,
			dispose: () => {
				this.watches.delete(watch);
				watch.changes.dispose();
				if (this.watches.size === 0) {
					this.poll?.dispose();
					this.poll = null;
				}
			},
		});
		return watching;
	}

	dispose(): void {
		this.poll?.dispose();
		this.poll = null;
		this.open.dispose();
	}

	/** Polls for other processes' writes while any watch is open. */
	private startPolling(): void {
		this.version = this.dataVersion();
		this.seen = this.lastSeq();
		this.poll = this.timer.setInterval(
			() => this.pollChanges(),
			Duration.ms(this.pollMs),
		);
	}

	/** Tells the watches of what another process wrote since the last poll. */
	private pollChanges(): void {
		let version: number;
		try {
			version = this.dataVersion();
		} catch {
			// The file went from under the open database: nothing more to hear.
			this.poll?.dispose();
			this.poll = null;
			return;
		}
		if (version === this.version) {
			return;
		}
		this.version = version;
		const last = this.lastSeq();
		const rows = this.db
			.query<{ key: string }, [number, number, string]>(
				"SELECT key FROM changes WHERE seq > ? AND seq <= ? AND by != ? ORDER BY seq",
			)
			.all(this.seen, last, this.token);
		this.seen = last;
		for (const { key } of rows) {
			this.tell(key);
		}
	}

	private dataVersion(): number {
		const row = this.db
			.query<{ data_version: number }, []>("PRAGMA data_version")
			.get();
		return row?.data_version ?? 0;
	}

	private lastSeq(): number {
		const row = this.db
			.query<{ seq: number | null }, []>("SELECT max(seq) AS seq FROM changes")
			.get();
		return row?.seq ?? 0;
	}

	/** Drops change notes older than any poll could still need, now and then. */
	private prune(now: number): void {
		if (now - this.lastPruned < KEEP_CHANGES.ms) {
			return;
		}
		this.lastPruned = now;
		this.db
			.query("DELETE FROM changes WHERE at < ?")
			.run(now - KEEP_CHANGES.ms);
	}

	/** Tells each watch whose reach `at` is in, as one on the disk would. */
	private tell(at: string): void {
		for (const watch of this.watches) {
			const inside = watch.at === "" || at.startsWith(`${watch.at}/`);
			const direct =
				at === watch.at ||
				(inside &&
					!at.slice(watch.at === "" ? 0 : watch.at.length + 1).includes("/"));
			if (direct || (watch.recursive && inside)) {
				const relative =
					watch.root === "" ? at : at.slice(watch.root.length + 1);
				watch.changes.dispatch("changed", relative);
			}
		}
	}
}

/** How long a change note is kept for another process's poll to find. */
const KEEP_CHANGES = Duration.secs(60);

interface Watching {
	at: string;
	/** The root of the storage that watches, which the keys it is told are relative to. */
	root: string;
	recursive: boolean;
	changes: Dispatcher<StorageChanges>;
}

/**
 * Documents and a collection's records and blobs in `kv`; a log's entries one
 * row each in `entries`, owned by the log's key until rotated into a segment,
 * then by the segment's; the locks; and the change notes the watches poll.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
	key TEXT PRIMARY KEY,
	data BLOB NOT NULL,
	text INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS entries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	log TEXT NOT NULL,
	segment TEXT,
	line TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_by_owner ON entries (log, segment, id);
CREATE INDEX IF NOT EXISTS entries_by_segment ON entries (segment, id);
-- Quota checks use the current owner: avoid scanning every conversation log for each folder.
CREATE INDEX IF NOT EXISTS entries_by_key ON entries (coalesce(segment, log));
CREATE TABLE IF NOT EXISTS segments (
	key TEXT PRIMARY KEY,
	log TEXT NOT NULL,
	name TEXT NOT NULL,
	at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS segments_by_log ON segments (log, name);
CREATE TABLE IF NOT EXISTS locks (
	key TEXT PRIMARY KEY,
	pid INTEGER NOT NULL,
	hostname TEXT NOT NULL,
	at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS changes (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	key TEXT NOT NULL,
	by TEXT NOT NULL,
	at INTEGER NOT NULL
);
`;
