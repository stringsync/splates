import type { Fs } from "webappwiz/system";
import { readIfThere } from "./atomic";
import { entriesOf, logLines } from "./json";
import type { Log, Segment } from "./log";
import type { Schema } from "./schema";

/**
 * A log kept as a JSON-lines file, its segments as files named for when they
 * were rotated in a directory of their own, as the journal keeps them.
 */
export class FsLog<T> implements Log<T> {
	constructor(
		readonly key: string,
		readonly path: string,
		/** The directory its segments are kept in. */
		readonly segmentsDir: string,
		private readonly fs: Fs,
		private readonly schema?: Schema<T>,
	) {}

	async append(...entries: T[]): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		await this.fs.append(this.path, logLines(entries));
	}

	replay(): Promise<T[]> {
		return this.entries(this.path);
	}

	async rotate(): Promise<Segment | null> {
		if (!(await this.fs.exists(this.path))) {
			return null;
		}
		const at = Date.now();
		const segment = { name: `${at}-${crypto.randomUUID()}.jsonl`, at };
		await this.fs.mkdir(this.segmentsDir);
		try {
			await this.fs.rename(this.path, this.at(segment));
		} catch (error) {
			// Another writer rotated it first.
			if (await this.fs.exists(this.path)) {
				throw error;
			}
			return null;
		}
		return segment;
	}

	async segments(): Promise<Segment[]> {
		const files =
			(await readIfThere(this.fs, this.segmentsDir, (dir) =>
				this.fs.readdir(dir),
			)) ?? [];
		return files
			.filter((file) => file.endsWith(".jsonl"))
			.sort()
			.map((name) => ({ name, at: Number.parseInt(name, 10) }));
	}

	replaySegment(segment: Segment): Promise<T[]> {
		return this.entries(this.at(segment));
	}

	dropSegment(segment: Segment): Promise<void> {
		return this.fs.rm(this.at(segment), { force: true });
	}

	async remove(): Promise<void> {
		await this.fs.rm(this.path, { force: true });
		await this.fs.rm(this.segmentsDir, { recursive: true, force: true });
	}

	private at(segment: Segment): string {
		return `${this.segmentsDir}/${segment.name}`;
	}

	private async entries(path: string): Promise<T[]> {
		const raw = await readIfThere(this.fs, path, (path) => this.fs.read(path));
		return entriesOf(raw ?? "", this.schema);
	}
}
