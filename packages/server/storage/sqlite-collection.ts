import type { Collection, CollectionEntry } from "./collection";
import { checkName } from "./key";
import type { SqliteDb } from "./sqlite-db";
import { decode, encode, inRange, rangeParams } from "./sqlite-keys";

/**
 * A collection kept as the rows directly under its key: records and blobs,
 * and, as a directory holds its files, the logs kept there, which `list`
 * names and `read` gives as their lines.
 */
export class SqliteCollection implements Collection {
	constructor(
		readonly key: string,
		/** The collection's key in the whole database. */
		readonly at: string,
		private readonly db: SqliteDb,
		/** Drops the copy written out for an agent to read, when a record goes. */
		private readonly forget: (key: string) => Promise<void> = async () => {},
	) {}

	async ensure(): Promise<void> {}

	async read(name: string): Promise<string | null> {
		const bytes = await this.readBytes(name);
		return bytes === null ? null : decode(bytes);
	}

	async write(name: string, text: string): Promise<void> {
		this.put(name, encode(text), 1);
	}

	async readBytes(name: string): Promise<Uint8Array | null> {
		const key = this.keyOf(name);
		const row = this.db.db
			.query<{ data: Uint8Array }, [string]>(
				"SELECT data FROM kv WHERE key = ?",
			)
			.get(key);
		if (row !== null) {
			return row.data;
		}
		const lines = this.db.db
			.query<{ line: string }, [string]>(
				"SELECT line FROM entries WHERE log = ? AND segment IS NULL ORDER BY id",
			)
			.all(key);
		return lines.length === 0
			? null
			: encode(lines.map((row) => `${row.line}\n`).join(""));
	}

	async writeBytes(name: string, bytes: Uint8Array): Promise<void> {
		this.put(name, bytes, 0);
	}

	async list(): Promise<string[]> {
		return (await this.entries()).map((entry) => entry.name);
	}

	async entries(): Promise<CollectionEntry[]> {
		const params = rangeParams(this.at);
		const from = this.at === "" ? 1 : this.at.length + 2;
		return this.db.db
			.query<
				CollectionEntry,
				[number, ...typeof params, number, ...typeof params]
			>(
				`SELECT name, size FROM (
					SELECT substr(key, ?) AS name, length(data) AS size FROM kv
					WHERE ${inRange("key")}
					UNION ALL
					SELECT substr(log, ?) AS name, sum(length(CAST(line AS BLOB)) + 1) AS size
					FROM entries WHERE segment IS NULL AND ${inRange("log")} GROUP BY log
				) WHERE instr(name, '/') = 0 ORDER BY name`,
			)
			.all(from, ...params, from, ...params);
	}

	async remove(name: string): Promise<void> {
		const key = this.keyOf(name);
		this.db.write(() => {
			const { changes } = this.db.db
				.query("DELETE FROM kv WHERE key = ?")
				.run(key);
			return changes > 0 ? [key] : [];
		});
		await this.forget(key);
	}

	async clear(): Promise<void> {
		for (const name of await this.list()) {
			await this.remove(name);
		}
	}

	async size(): Promise<number> {
		return (await this.entries()).reduce((sum, entry) => sum + entry.size, 0);
	}

	private keyOf(name: string): string {
		const checked = checkName(name);
		return this.at === "" ? checked : `${this.at}/${checked}`;
	}

	private put(name: string, data: Uint8Array, text: 0 | 1): void {
		const key = this.keyOf(name);
		this.db.write(() => {
			this.db.db
				.query("INSERT OR REPLACE INTO kv (key, data, text) VALUES (?, ?, ?)")
				.run(key, data, text);
			return [key];
		});
	}
}
