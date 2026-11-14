/** One thing rec can follow besides the page: a running container or a log file. */
export interface RecSource {
	kind: "docker" | "file";
	/** A container's name, or a file's path. */
	name: string;
	/** A container's Compose project, when it has one. */
	project?: string;
}

/** What rec says about itself while it runs; the fields past `recording` come with newer rec. */
export interface RecStatus {
	running: boolean;
	name?: string;
	recording?: boolean;
	/** Wall-clock ms the recording began. */
	startedAt?: number;
	mic?: "on" | "off";
	laser?: boolean;
	/** Sessions rec is still transcribing or ranking; absent from an older rec. */
	processing?: string[];
	/** How the last recording ended; absent before one has, and from an older rec. */
	lastOutcome?:
		| { status: "saved"; name: string }
		| { status: "failed"; reason: string };
}

/** What the Rec page shows. */
export interface RecState {
	/** Whether `rec` runs as a command on the server's machine. */
	available: boolean;
	/** The machine Chrome opens on. */
	host: string;
	/** Whether the page asking is open on that machine, so the Chrome rec opens is in front of the user; false through a tunnel. */
	here?: boolean;
	status: RecStatus;
	/** The Compose project of the folder this server runs in: its group is listed first. */
	project?: string;
	/** Running Docker containers; log files are the person's to add. */
	sources: RecSource[];
	/** Why Docker's containers could not be listed. */
	sourcesError?: string;
}

/** What opening rec asks for. */
export interface RecOpen {
	name: string;
	url: string;
	/** Container names to follow. */
	docker: string[];
	/** Log file paths to follow. */
	tails: string[];
}

/** One saved session, as the history lists it. */
export interface RecSessionSummary {
	name: string;
	folder: string;
	/** Wall-clock ms the recording began. */
	startedAt: number;
	/** Seconds of recording. */
	length: number;
	/** Bytes on disk. */
	size: number;
	moments: number;
	/** What was said at the top moment, else the first thing said. */
	topSaid?: string;
}

/** Every saved session, newest first, and how full rec's store is. */
export interface RecSessions {
	sessions: RecSessionSummary[];
	totalSize: number;
	limit: number;
	/** What rec does when the store is full, in rec's words. */
	policy: string;
}

import type { RecTimelineEntry } from "./timeline.ts";

export type { RecEntryKind, RecTimelineEntry } from "./timeline.ts";

/** A moment of a session, times in wall-clock ms like the rest of rec's files. */
export interface RecMoment {
	rank: number;
	start: number;
	end: number;
	score: number;
	said?: string;
	pointed?: string;
	still?: string;
	signals: {
		at: number;
		signal: string;
		source: string;
		detail: Record<string, unknown>;
	}[];
}

/** A session with what its page shows. */
export interface RecSessionDetail extends RecSessionSummary {
	moments: number;
	momentList: RecMoment[];
	/** The timeline file's text. */
	timeline?: string;
	/** Moments, pointers, routes and log lines together, in video time. */
	entries: RecTimelineEntry[];
	/** File names, each served under the session. */
	stills: string[];
	logs: string[];
	/** Whether the recording file is there to play. */
	video: boolean;
}

/** A hit of the history's search. */
export interface RecSessionMatch {
	name: string;
	in: "name" | "said";
	snippet: string;
}

/** What rec does when its store passes its limit. */
export const REC_STORE_POLICY =
	"At 5 GB, rec deletes the oldest sessions first, whatever their name.";
