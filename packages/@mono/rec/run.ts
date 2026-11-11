import type { Logger } from "core/log";
import type { Fs, Ps } from "core/system";
import type { WallClock } from "core/time";
import type { ExtraLogs } from "./extra-logs";
import type { LiveSignals } from "./live-signals";
import type { LiveSpeech } from "./live-speech";
import type { BrowserLogs } from "./logs";
import type { PointerEvents } from "./pointer";
import type { RecorderStats, ToServer } from "./protocol";
import type { Manifest, SessionFolder } from "./session";

export interface RecorderDeps {
	fs: Fs;
	ps: Ps;
	log: Logger;
	wall: WallClock;
}

/** Extra pages the server hands out, such as the bench's working page. */
export type Routes = Record<
	string,
	Response | ((request: Request) => Response | Promise<Response>)
>;

/** One recording: everything that belongs to a single Start, so the next Start shares nothing with it. */
export interface Run {
	started: Extract<ToServer, { type: "started" }>;
	/** Resolves with the session folder once its first write is done; chunks and capture queue behind it. */
	writing: Promise<void>;
	session: SessionFolder;
	logs?: BrowserLogs;
	extra?: ExtraLogs;
	pointer?: PointerEvents;
	live?: LiveSignals;
	speech?: LiveSpeech;
	sources: { docker?: string; tails: string[] };
	dropped: number;
	receivedBefore: number;
	finished: (stats: RecorderStats & { at: number }) => void;
	failed: (error: Error) => void;
	done: Promise<RecorderStats & { at: number }>;
	saved?: Promise<Manifest>;
}
