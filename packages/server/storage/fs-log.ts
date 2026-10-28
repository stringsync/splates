import { dirname } from "node:path";
import type { Fs } from "webappwiz/system";
import { readIfThere, replace } from "./atomic";
import { entriesOf, logLines } from "./json";
import type { Log, Segment } from "./log";
import type { Schema } from "./schema";

/** A log for `FsStorage`: open one with `FsStorage.log` and use it as any `Log`. */
// Its segments sit in a directory of their own, as the journal keeps them.
export class FsLog<T> implements Log<T> {
	/** Whether the file's directory is known to be there. */
	private made = false;
	/** Whether the file last read back ended mid-line, as a crash mid-append leaves it. */
	private torn = false;

	constructor(
		readonly key: string,
		readonly path: string,
		/** The directory its segments are kept in. */
		readonly segmentsDir: string,
		private readonly fs: Fs,
		private readonly schema?: Schema<T>,
	) {}

	exists(): Promise<boolean> {
		return this.fs.exists(this.path);
	}

	async append(...entries: T[]): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		if (!this.made) {
			await this.fs.mkdir(dirname(this.path));
			this.made = true;
		}
		// A line cut short stays apart from the next, rather than taking it too.
		const lines = logLines(entries);
		await this.fs.append(this.path, this.torn ? `\n${lines}` : lines);
		this.torn = false;
	}

	async replay(): Promise<T[]> {
		const raw = await this.read(this.path);
		this.torn = raw !== "" && !raw.endsWith("\n");
		return entriesOf(raw, this.schema);
	}

	async first(): Promise<T | null> {
		return (await this.replay())[0] ?? null;
	}

	async compact(merge: (entries: T[]) => T[]): Promise<void> {
		const entries = await this.replay();
		const merged = merge(entries);
		if (merged.length >= entries.length) {
			return;
		}
		// A file has no transaction: an append from another process between
		// the read and the rename is lost, which the one server writing a
		// conversation's log never makes.
		await replace(this.fs, this.path, logLines(merged));
		this.torn = false;
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
		this.torn = false;
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

	async replaySegment(segment: Segment): Promise<T[]> {
		return entriesOf(await this.read(this.at(segment)), this.schema);
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

	private async read(path: string): Promise<string> {
		return (
			(await readIfThere(this.fs, path, (path) => this.fs.read(path))) ?? ""
		);
	}
}
