import type { SignalRow } from "./live-signals";
import type { Frame } from "./screencast";
import type { Manifest } from "./session";

/** Gets each line a source follows, with its time. */
export interface LineSink {
	line(at: number, text: string): void;
}

/** Hears each scrubbed log line and the file it goes to. */
export interface LogEntries {
	entry(file: string, line: string): void;
}

/** Hears a problem that does not stop the recording. */
export interface Notes {
	note(text: string): void;
}

/** Says which pages a recording leaves alone, such as the control window. */
export interface PageFilter {
	skips(url: string): boolean;
}

/** Finds the page's screencast frame nearest a time. */
export interface FrameSource {
	frameAt(at: number): Frame | undefined;
}

/** Picks the folder each session is saved in, as its Start arrives. */
export interface SessionDirs {
	next(): Promise<string>;
}

/** What a recorder raises. */
export interface RecorderEvents extends Record<string, unknown> {
	saved: { dir: string; manifest: Manifest };
}

/** Gets each row the panel's signal list shows. */
export interface SignalRows {
	row(row: SignalRow): void;
}

/** Leaves alone the control window and browser extension pages. */
export class OtherPages implements PageFilter {
	constructor(private readonly origin: string) {}

	skips(url: string): boolean {
		return url.startsWith(this.origin) || url.startsWith("chrome-extension://");
	}
}

export const NO_ENTRIES: LogEntries = { entry() {} };
