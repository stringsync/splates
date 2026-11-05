import type { Fs } from "core/system";
import type { Scrubber } from "./scrub";

/** Appends scrubbed lines to files under a session's `logs/`, in the order they came. */
export class LogWriter {
	private writing = Promise.resolve();

	constructor(
		private readonly fs: Fs,
		private readonly dir: string,
		private readonly scrubber: Scrubber,
		private readonly onEntry: (file: string, line: string) => void = () => {},
	) {}

	append(file: string, line: string): void {
		const clean = this.scrubber.scrub(line);
		this.onEntry(file, clean);
		this.writing = this.writing
			.then(() => this.fs.append(`${this.dir}/${file}`, `${clean}\n`))
			.catch(() => undefined);
	}

	flush(): Promise<void> {
		return this.writing;
	}
}
