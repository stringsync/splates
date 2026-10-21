import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { SystemWallClock, type WallClock } from "webappwiz/time";

/** How large the log grows before it is moved aside to `<path>.1`, replacing the one there. */
export const LOG_FILE_BYTES = 1024 * 1024;

/**
 * Appends each line, stamped with the time, to the file at `path`, in the
 * order said, keeping it and the one before it under `LOG_FILE_BYTES` each:
 * where a worker with no terminal to read says what it did, so a stall
 * after a restart can be traced. A line that cannot be written is dropped.
 */
export class FileLogger implements Logger {
	private writing: Promise<void> = Promise.resolve();

	constructor(
		private readonly fs: Fs,
		private readonly path: string,
		private readonly wall: WallClock = new SystemWallClock(),
	) {}

	info(message: unknown, ...optionalParams: unknown[]): void {
		this.say("info", message, optionalParams);
	}

	error(message: unknown, ...optionalParams: unknown[]): void {
		this.say("error", message, optionalParams);
	}

	/** Resolves once every line said so far is written. */
	flushed(): Promise<void> {
		return this.writing;
	}

	private say(level: string, message: unknown, params: unknown[]): void {
		const text = [message, ...params].map(String).join(" ");
		const line = `${new Date(this.wall.now()).toISOString()} ${level} ${text}\n`;
		this.writing = this.writing.then(() => this.write(line)).catch(() => {});
	}

	private async write(line: string): Promise<void> {
		const size = await this.fs
			.stat(this.path)
			.then((stat) => stat.size)
			.catch(() => 0);
		if (size + line.length > LOG_FILE_BYTES) {
			await this.fs.rename(this.path, `${this.path}.1`).catch(() => {});
		}
		await this.fs.append(this.path, line);
	}
}
