import type { SignalClock } from "./clock-schedule";
/** One raise of a signal: a fact announced by an agent, with an optional payload. */
export interface SignalRaise {
	/** When it was raised, as an ISO time. */
	at: string;
	/** Who raised it: the task or conversation, as the agent named itself. */
	by: string;
	/** What the raiser attached; null for none. */
	payload: unknown;
}

/** How a wait stands: it ends once, as raised, timed out or stopped. */
export type SignalState =
	| "waiting"
	| "raised"
	| "timed out"
	| "stopped"
	| "removed";

/**
 * A conversation's subscription to a signal, shown as one card that follows
 * it. A wait is delivered once; the next raise of the name starts nothing.
 */
export interface SignalWait {
	clock?: SignalClock;
	/** Its own id, unique in its conversation. */
	id: string;
	/** The signal's name, `<project>.<name>`. */
	name: string;
	/** What the agent waits for, in its words, shown on the card in every state. */
	description: string;
	state: SignalState;
	/** Why the source was removed. */
	reason?: string;
	/** A declared signal function supplied this wait, so undeclaring it ends the wait. */
	family?: string; // stored key; names the signal function
	/** When it began, as an ISO time. */
	startedAt: string;
	/** When it times out, as an ISO time. */
	deadline: string;
	/** A raise from after this time counts, as an ISO time; null counts only raises after `startedAt`. */
	since: string | null;
	/** When it ended; absent while it waits. */
	endedAt?: string;
	/** The raise that ended it, once raised. */
	raise?: SignalRaise;
	/** The task its conversation was in when it began; once that task ends, the wait no longer counts as subscribed. */
	task?: string | null;
}

/** How long a signal keeps its raises, so a `--since` reaches back no further. */
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** The longest a wait may last. */
export const LONGEST_WAIT_MS = RETENTION_MS;

/** The shortest gap a probe may keep between its runs. */
export const PROBE_FLOOR_MS = 30_000;

/** The longest one run of a probe's script may take before it counts as failing. */
export const PROBE_RUN_MS = 2 * 60_000;

/** How many of its latest runs a probe keeps, for its card. */
export const PROBE_RUNS_KEPT = 50;

/** How much of each stream a run keeps: its last lines, at most this many characters. */
export const PROBE_STREAM_LINES = 50;
export const PROBE_STREAM_CHARS = 4000;

/** What started a run: its interval, a wait beginning, or the person's Poll now. */
export type ProbeStart = "scheduled" | "wait" | "poll now";

/** One run of a probe's script: passed when it exited 0. */
export interface ProbeRun {
	/** When it ran, as an ISO time. */
	at: string;
	/** Its exit code. */
	exit: number;
	/** The last lines it printed, stdout then stderr, trimmed. */
	output: string;
	/** How long it ran, in ms; absent on runs from before it was kept. */
	ms?: number;
	/** What started it; absent on older runs. */
	startedBy?: ProbeStart;
	/** Whether it fired the signal; absent on older runs. */
	fired?: boolean;
	/** The last of what it printed to stdout, trimmed; absent on older runs. */
	stdout?: string;
	/** The last of what it printed to stderr, trimmed; absent on older runs. */
	stderr?: string;
}

/**
 * How a probe stands. It idles until something subscribes to its signal,
 * runs while anything does, and ends once, as raised (its waits all
 * delivered), timed out, orphaned (its last subscription ended) or stopped by
 * the person, or replaced by a new probe on the same signal.
 */
export type ProbeState =
	| "idle"
	| "running"
	| "raised"
	| "timed out"
	| "orphaned"
	| "stopped"
	| "replaced";

/**
 * A signal's probe as `splates signal probe` started it and its card shows
 * it: the script, its schedule, its latest runs and how it stands.
 */
export interface SignalProbe {
	/** The signal it raises, `<project>.<name>`. */
	name: string;
	/** What it checks for, in the agent's words. */
	description: string;
	/** The script it runs, as given after `--`. */
	script: string;
	/** How long it waits between runs, in milliseconds. */
	everyMs: number;
	/** Where it runs: its project's main tree. */
	cwd: string;
	/** The conversation that started it, which shows its card. */
	conversation: string;
	/** The call's arguments as JSON, given to the script in `$SPLATES_ARGS`; absent for none. */
	args?: string;
	state: ProbeState;
	/** When it was started, as an ISO time. */
	startedAt: string;
	/** When it stops, as an ISO time. */
	deadline: string;
	/** When it ended; absent while it idles or runs. */
	endedAt?: string;
	/** Whether its last run passed; null before it first ran. */
	passed: boolean | null;
	/** Whether anything ever subscribed while it was on, so that none left means orphaned. */
	subscribed: boolean;
	/** How many runs it has made, all told. */
	count: number;
	/** Its latest runs, oldest first, at most `PROBE_RUNS_KEPT`. */
	runs: ProbeRun[];
	/** When it next runs, as an ISO time; absent while idle or ended. */
	next?: string;
}

/** One thing subscribed to a signal: a conversation's wait, or an automation set on it. */
export interface SignalSubscriber {
	kind: "wait" | "automation" | "task";
	/** The wait's id in its conversation, or the automation's id. */
	id: string;
	/** What it waits for, or the automation's name. */
	label: string;
	/** How it stands: a wait's state, a task's `open`, or an automation's `active`, `paused` or `finished`. */
	state: SignalState | "active" | "paused" | "finished" | "open";
	endedAt?: string;
	reason?: string;
	/** Whether it still waits for a raise, or an automation is not paused. */
	live: boolean;
	/** The conversation that waits, for a wait. */
	conversation?: string;
	/** That conversation's name, for a wait. */
	title?: string | null;
	/** When a wait times out, as an ISO time. */
	deadline?: string;
	/** The slug of the project an automation belongs to, to reach it. */
	project?: string;
}

/** One signal as the Signals page shows it, across every project. */
export interface SignalOverview {
	clock?: SignalClock;
	/** Optional automatic removal time. */
	expiresAt?: string;
	/** What it means when it fires, in an agent's words: its probe's description, else its newest wait's; absent when neither gave one. */
	description?: string;
	/** `<project>.<name>`. */
	name: string;
	/** The namespace: the part before the first dot. */
	project: string;
	/** The probe on it, kept for a week, or null for none. */
	probe: SignalProbe | null;
	subscribers: SignalSubscriber[];
	/** Its raises of the last 7 days, newest first. */
	raises: SignalRaise[];
}
