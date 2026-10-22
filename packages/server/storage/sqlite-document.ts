import type { Lock } from "webappwiz/system";
import type { Document } from "./document";
import { documentText } from "./json";
import type { Schema } from "./schema";
import type { SqliteDb } from "./sqlite-db";
import { decode, encode } from "./sqlite-keys";

/** A document kept as one row, replaced whole on each write. */
export class SqliteDocument<T> implements Document<T> {
	constructor(
		readonly key: string,
		/** The key in the whole database, which a view's `key` is relative to. */
		readonly at: string,
		private readonly db: SqliteDb,
		private readonly lock: Lock,
		private readonly schema?: Schema<T>,
	) {}

	async read(): Promise<T | null> {
		const row = this.db.db
			.query<{ data: Uint8Array }, [string]>(
				"SELECT data FROM kv WHERE key = ?",
			)
			.get(this.at);
		if (row === null) {
			return null;
		}
		try {
			const value: unknown = JSON.parse(decode(row.data));
			return this.schema === undefined
				? (value as T)
				: this.schema.parse(value);
		} catch (error) {
			throw new Error(`${this.at} is not readable: ${String(error)}`);
		}
	}

	async write(value: T): Promise<void> {
		const data = encode(documentText(value));
		this.db.write(() => {
			this.db.db
				.query("INSERT OR REPLACE INTO kv (key, data, text) VALUES (?, ?, 1)")
				.run(this.at, data);
			return [this.at];
		});
	}

	async update(edit: (current: T | null) => T | Promise<T>): Promise<T> {
		await this.lock.acquire();
		try {
			const value = await edit(await this.read());
			await this.write(value);
			return value;
		} finally {
			await this.lock.release();
		}
	}

	async remove(): Promise<void> {
		this.db.write(() => {
			const { changes } = this.db.db
				.query("DELETE FROM kv WHERE key = ?")
				.run(this.at);
			return changes > 0 ? [this.at] : [];
		});
	}
}
