import { entriesOf } from "./json";
import type { Log, Segment } from "./log";
import type { Schema } from "./schema";
import type { SqliteDb } from "./sqlite-db";

/**
 * A log kept one entry per row, each owned by the log's key until rotated,
 * then by its segment's, so a crash mid-append tears no line.
 */
export class SqliteLog<T> implements Log<T> {
	constructor(
		readonly key: string,
		/** The log's key in the whole database. */
		readonly at: string,
		/** The key its segments are kept under. */
		readonly segmentsAt: string,
		private readonly db: SqliteDb,
		private readonly schema?: Schema<T>,
	) {}

	async exists(): Promise<boolean> {
		return (
			(this.db.db
				.query<{ n: number }, [string]>(
					"SELECT count(*) AS n FROM entries WHERE log = ? AND segment IS NULL",
				)
				.get(this.at)?.n ?? 0) > 0
		);
	}

	async append(...entries: T[]): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		this.db.write(() => {
			const insert = this.db.db.query(
				"INSERT INTO entries (log, segment, line) VALUES (?, NULL, ?)",
			);
			for (const entry of entries) {
				insert.run(this.at, JSON.stringify(entry));
			}
			return [this.at];
		});
	}

	async replay(): Promise<T[]> {
		return entriesOf(
			this.lines("log = ? AND segment IS NULL", this.at),
			this.schema,
		);
	}

	async rotate(): Promise<Segment | null> {
		let rotated: Segment | null = null;
		this.db.write(() => {
			const at = Date.now();
			const segment = { name: `${at}-${crypto.randomUUID()}.jsonl`, at };
			const key = this.segmentKey(segment);
			const { changes } = this.db.db
				.query(
					"UPDATE entries SET segment = ? WHERE log = ? AND segment IS NULL",
				)
				.run(key, this.at);
			if (changes === 0) {
				return [];
			}
			this.db.db
				.query("INSERT INTO segments (key, log, name, at) VALUES (?, ?, ?, ?)")
				.run(key, this.at, segment.name, at);
			rotated = segment;
			return [this.at, key];
		});
		return rotated;
	}

	async segments(): Promise<Segment[]> {
		return this.db.db
			.query<{ name: string; at: number }, [string]>(
				"SELECT name, at FROM segments WHERE log = ? ORDER BY name",
			)
			.all(this.at);
	}

	async replaySegment(segment: Segment): Promise<T[]> {
		return entriesOf(
			this.lines("segment = ?", this.segmentKey(segment)),
			this.schema,
		);
	}

	async dropSegment(segment: Segment): Promise<void> {
		const key = this.segmentKey(segment);
		this.db.write(() => {
			this.db.db.query("DELETE FROM entries WHERE segment = ?").run(key);
			const { changes } = this.db.db
				.query("DELETE FROM segments WHERE key = ?")
				.run(key);
			return changes > 0 ? [key] : [];
		});
	}

	async remove(): Promise<void> {
		this.db.write(() => {
			const gone = this.db.db
				.query<{ key: string }, [string]>(
					"SELECT key FROM segments WHERE log = ?",
				)
				.all(this.at)
				.map((row) => row.key);
			const { changes } = this.db.db
				.query("DELETE FROM entries WHERE log = ?")
				.run(this.at);
			this.db.db.query("DELETE FROM segments WHERE log = ?").run(this.at);
			return changes > 0 || gone.length > 0 ? [this.at, ...gone] : [];
		});
	}

	private segmentKey(segment: Segment): string {
		return `${this.segmentsAt}/${segment.name}`;
	}

	/** The entries `where` picks, oldest first, as the lines of a file. */
	private lines(where: string, param: string): string {
		return this.db.db
			.query<{ line: string }, [string]>(
				`SELECT line FROM entries WHERE ${where} ORDER BY id`,
			)
			.all(param)
			.map((row) => `${row.line}\n`)
			.join("");
	}
}
