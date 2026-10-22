import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs, Lock, Ps } from "webappwiz/system";
import type { Timer } from "webappwiz/time";
import { replace } from "./atomic";
import type { Collection } from "./collection";
import type { Document, DocumentOptions } from "./document";
import { keyIn } from "./key";
import type { Log, LogOptions } from "./log";
import { SqliteCollection } from "./sqlite-collection";
import { SqliteDb } from "./sqlite-db";
import { SqliteDocument } from "./sqlite-document";
import { importTree } from "./sqlite-import";
import { inRange, rangeParams } from "./sqlite-keys";
import { SqliteLock } from "./sqlite-lock";
import { SqliteLog } from "./sqlite-log";
import type { Kept, Storage, Watch, WatchOptions } from "./storage";

export interface SqliteStorageOptions {
	fs: Fs;
	ps: Ps;
	log?: Logger;
	timer?: Timer;
	/** After how long a lock held from another host counts as stale. */
	stalenessMs?: number;
	/** How often a watch looks for another process's writes, and a waiter for a lock's release. */
	pollMs?: number;
	/**
	 * Where `materialize` writes a copy for an agent to read as a file:
	 * `<path>.files` by default.
	 */
	cache?: string;
}

/**
 * Storage kept in one SQLite database at `path`, which every process on the
 * machine opens; what an agent must read as a file is copied out beside it.
 * Dispose the storage opened to close the database; a view `within` shares it.
 */
export class SqliteStorage implements Storage, Resource {
	static open(path: string, opts: SqliteStorageOptions): SqliteStorage {
		return new SqliteStorage("", {
			db: new SqliteDb(path, { timer: opts.timer, pollMs: opts.pollMs }),
			ps: opts.ps,
			log: opts.log,
			stalenessMs: opts.stalenessMs ?? 90_000,
			pollMs: opts.pollMs,
			cache: { dir: opts.cache ?? `${path}.files`, fs: opts.fs },
		});
	}

	private constructor(
		readonly root: string,
		private readonly shared: Shared,
	) {}

	document<T>(key: string, opts: DocumentOptions<T> = {}): Document<T> {
		return new SqliteDocument(
			key,
			this.full(key),
			this.shared.db,
			this.lock(opts.lock ?? `${key}.lock`),
			opts.schema,
		);
	}

	log<T>(key: string, opts: LogOptions<T> = {}): Log<T> {
		return new SqliteLog(
			key,
			this.full(key),
			this.full(opts.segments ?? `${key}.segments`),
			this.shared.db,
			opts.schema,
		);
	}

	collection(key: string): Collection {
		return new SqliteCollection(key, this.full(key), this.shared.db, (at) =>
			this.shared.cache.fs.rm(keyIn(this.shared.cache.dir, at), {
				force: true,
			}),
		);
	}

	lock(key: string): Lock {
		const { db, ps, log, stalenessMs, pollMs } = this.shared;
		return new SqliteLock(this.full(key), { db, ps, log, stalenessMs, pollMs });
	}

	watch(key: string, opts: WatchOptions = {}): Watch {
		return this.shared.db.watch(this.root, this.full(key), opts);
	}

	locate(key: string): string {
		return keyIn(this.shared.cache.dir, this.full(key));
	}

	async materialize(key: string): Promise<string> {
		const { cache, db } = this.shared;
		const path = this.locate(key);
		const at = this.full(key);
		const row = db.db
			.query<{ data: Uint8Array }, [string]>(
				"SELECT data FROM kv WHERE key = ?",
			)
			.get(at);
		if (row !== null) {
			await replace(cache.fs, path, row.data);
			return path;
		}
		const lines = db.db
			.query<{ line: string }, [string, string]>(
				"SELECT line FROM entries WHERE (segment IS NULL AND log = ?) OR segment = ? ORDER BY id",
			)
			.all(at, at);
		if (lines.length > 0) {
			await replace(
				cache.fs,
				path,
				lines.map((row) => `${row.line}\n`).join(""),
			);
		} else {
			await cache.fs.rm(path, { force: true });
		}
		return path;
	}

	async children(key: string): Promise<string[]> {
		const at = this.full(key);
		const params = rangeParams(at);
		const from = at === "" ? 1 : at.length + 2;
		return this.shared.db.db
			.query<
				{ child: string },
				[number, ...typeof params, number, ...typeof params]
			>(
				`SELECT DISTINCT substr(rest, 1, instr(rest, '/') - 1) AS child FROM (
					SELECT substr(key, ?) AS rest FROM kv WHERE ${inRange("key")}
					UNION
					SELECT substr(coalesce(segment, log), ?) AS rest FROM entries
					WHERE ${inRange("coalesce(segment, log)")}
				) WHERE instr(rest, '/') > 0 ORDER BY child`,
			)
			.all(from, ...params, from, ...params)
			.map((row) => row.child);
	}

	async size(key: string): Promise<number> {
		const params = rangeParams(this.full(key));
		const row = this.shared.db.db
			.query<{ bytes: number | null }, [...typeof params, ...typeof params]>(
				`SELECT (
					(SELECT coalesce(sum(length(data)), 0) FROM kv WHERE ${inRange("key")})
					+ (SELECT coalesce(sum(length(CAST(line AS BLOB)) + 1), 0) FROM entries
						WHERE ${inRange("coalesce(segment, log)")})
				) AS bytes`,
			)
			.get(...params, ...params);
		return row?.bytes ?? 0;
	}

	async keys(key: string): Promise<string[]> {
		const params = rangeParams(this.full(key));
		const from = this.root === "" ? 1 : this.root.length + 2;
		return this.shared.db.db
			.query<{ key: string }, [number, ...typeof params, ...typeof params]>(
				`SELECT substr(key, ?) AS key FROM (
					SELECT key FROM kv WHERE ${inRange("key")}
					UNION
					SELECT coalesce(segment, log) AS key FROM entries
					WHERE ${inRange("coalesce(segment, log)")}
				) ORDER BY key`,
			)
			.all(from, ...params, ...params)
			.map((row) => row.key);
	}

	async copy(key: string, from = 0): Promise<Kept | null> {
		const at = this.full(key);
		const { db } = this.shared.db;
		const row = db
			.query<{ data: Uint8Array }, [string]>(
				"SELECT data FROM kv WHERE key = ?",
			)
			.get(at);
		if (row !== null) {
			return { kind: "value", bytes: row.data };
		}
		const owned = "(segment IS NULL AND log = ?) OR segment = ?";
		const count =
			db
				.query<{ n: number }, [string, string]>(
					`SELECT count(*) AS n FROM entries WHERE ${owned}`,
				)
				.get(at, at)?.n ?? 0;
		if (count === 0) {
			return null;
		}
		const lines = db
			.query<{ line: string }, [string, string, number]>(
				`SELECT line FROM entries WHERE ${owned} ORDER BY id LIMIT -1 OFFSET ?`,
			)
			.all(at, at, from)
			.map((entry) => entry.line);
		return { kind: "log", lines, count };
	}

	async remove(key: string): Promise<void> {
		const at = this.full(key);
		const params = rangeParams(at);
		const { db } = this.shared.db;
		await this.shared.cache.fs.rm(this.locate(key), {
			recursive: true,
			force: true,
		});
		this.shared.db.write(() => {
			const gone = db
				.query<
					{ key: string },
					[string, ...typeof params, string, ...typeof params]
				>(
					`SELECT key FROM kv WHERE key = ? OR ${inRange("key")}
					UNION SELECT DISTINCT coalesce(segment, log) AS key FROM entries
					WHERE coalesce(segment, log) = ? OR ${inRange("coalesce(segment, log)")}`,
				)
				.all(at, ...params, at, ...params)
				.map((row) => row.key);
			db.query(`DELETE FROM kv WHERE key = ? OR ${inRange("key")}`).run(
				at,
				...params,
			);
			db.query(
				`DELETE FROM entries WHERE coalesce(segment, log) = ? OR ${inRange("coalesce(segment, log)")}`,
			).run(at, ...params);
			db.query(`DELETE FROM segments WHERE key = ? OR ${inRange("key")}`).run(
				at,
				...params,
			);
			return gone;
		});
	}

	/**
	 * Copies the files under `dir` on `fs` in, each at its path as a key, as
	 * a log, a record or a blob by its name: what moves records kept as files
	 * into the database. Leaves locks and stamps behind.
	 */
	async importFiles(fs: Fs, dir: string): Promise<void> {
		await importTree(this.shared.db, fs, dir, this.root);
	}

	within(key: string): Storage {
		return new SqliteStorage(this.full(key), this.shared);
	}

	dispose(): void {
		this.shared.db.dispose();
	}

	private full(key: string): string {
		return keyIn(this.root, key);
	}
}

/** What a `SqliteStorage` and every view of it share. */
interface Shared {
	db: SqliteDb;
	ps: Ps;
	log?: Logger;
	stalenessMs: number;
	pollMs?: number;
	/** Where `materialize` writes copies. */
	cache: { dir: string; fs: Fs };
}
