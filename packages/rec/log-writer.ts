import type { Fs } from "core/system";
import type { Scrubber } from "./scrub";
import { type LogEntries, NO_ENTRIES } from "./sinks";

export interface LogWriterOptions {
	/** Hears each line as it is written. */
	entries?: LogEntries;
}

/** Appends scrubbed lines to files under a session's `logs/`, in the order they came. */
export class LogWriter {
	private readonly entries: LogEntries;
	private writing = Promise.resolve();

	constructor(
		private readonly fs: Fs,
		private readonly dir: string,
		private readonly scrubber: Scrubber,
		opts: LogWriterOptions = {},
	) {
		this.entries = opts.entries ?? NO_ENTRIES;
	}

	append(file: string, line: string): void {
		const clean = this.scrubber.scrub(line);
		this.entries.entry(file, clean);
		this.writing = this.writing
			.then(() => this.fs.append(`${this.dir}/${file}`, `${clean}\n`))
			.catch(() => undefined);
	}

	flush(): Promise<void> {
		return this.writing;
	}
}
