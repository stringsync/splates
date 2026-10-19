import type { Fs, Lock } from "webappwiz/system";
import { readIfThere, replace } from "./atomic";
import type { Document } from "./document";
import { documentText } from "./json";
import type { Schema } from "./schema";

/** A document kept as one JSON file, replaced whole on each write. */
export class FsDocument<T> implements Document<T> {
	constructor(
		readonly key: string,
		readonly path: string,
		private readonly fs: Fs,
		private readonly lock: Lock,
		private readonly schema?: Schema<T>,
	) {}

	async read(): Promise<T | null> {
		const raw = await readIfThere(this.fs, this.path, (path) =>
			this.fs.read(path),
		);
		if (raw === null) {
			return null;
		}
		try {
			const value: unknown = JSON.parse(raw);
			return this.schema === undefined
				? (value as T)
				: this.schema.parse(value);
		} catch (error) {
			throw new Error(`${this.path} is not readable: ${String(error)}`);
		}
	}

	write(value: T): Promise<void> {
		return replace(this.fs, this.path, documentText(value));
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

	remove(): Promise<void> {
		return this.fs.rm(this.path, { force: true });
	}
}
