import { Duration } from "webappwiz/time";
import type { ReleaseStep } from "./release-steps";

/** A step not begun, expected to take `expected` ms, from ships before when `known`. */
export function pendingStage(
	key: StageKey,
	{ expected, known }: { expected: number; known: boolean } = {
		expected: STAGE_DEFAULTS[key].ms,
		known: false,
	},
): Stage {
	return {
		key,
		name: STAGE_NAMES[key],
		state: "pending",
		started: null,
		ended: null,
		expected,
		known,
		deadline: null,
		check: null,
		log: null,
	};
}

/**
 * Where one step of a project's part in a ship stands, for the page to show:
 * not begun, under way, waiting on a check, waiting on the person, hung
 * (under way past its deadline, and still going), done, failed, or skipped.
 */
export type StageState =
	| "pending"
	| "running"
	| "checking"
	| "asking"
	| "hung"
	| "done"
	| "failed"
	| "skipped";

/**
 * The steps a project's part in a ship takes: its bump task, that task's
 * merge gate and its merge, then signing in to npm, the publishes' second
 * factor, the ship command, and the versions it published checked against
 * the plan.
 */
export type StageKey =
	| "upstream"
	| "adopt"
	| "publish"
	| "live"
	| "bump"
	| "gate"
	| "merged"
	| "push"
	| "remote"
	| "login"
	| "otp"
	| "command"
	| "versions";

/** What splates last asked of a step, and what it heard. */
export interface StageCheck {
	at: string;
	result: string;
}

/** Where a step's output is in its project's ship log: bytes `from` to `to`, null while it prints. */
export interface StageLog {
	from: number;
	to: number | null;
}

/** One step of a project's part in a ship, in one shape for every step. */
export interface Stage {
	key: StageKey;
	/** What the page calls it. */
	name: string;
	state: StageState;
	started: string | null;
	ended: string | null;
	/** How long it is expected to take, in milliseconds. */
	expected: number;
	/** Whether {@link expected} comes from ships before, rather than a default. */
	known: boolean;
	/** When it shows hung, once started. */
	deadline: string | null;
	check: StageCheck | null;
	log: StageLog | null;
	/** On the ship command: the steps the project's own Release reports, as they stand; absent when it reports none. */
	releaseSteps?: ReleaseStep[];
}

/** When a step that started at `started` shows hung. */
export function deadlineOf(stage: Stage, started: string): string {
	const after = stage.known
		? stage.expected * DEADLINE_TIMES
		: FIRST_DEADLINE.ms;
	return new Date(Date.parse(started) + after).toISOString();
}

/** `stage` begun at `at` in `state`, unless it began already. */
export function begun(
	stage: Stage,
	at: string,
	state: StageState = "running",
): Stage {
	const started = stage.started ?? at;
	return {
		...stage,
		state,
		started,
		ended: null,
		deadline: stage.deadline ?? deadlineOf(stage, started),
	};
}

/** `stage` ended at `at` in `state`, begun then too when it never began. */
export function ended(stage: Stage, at: string, state: StageState): Stage {
	const started = stage.started ?? at;
	return {
		...stage,
		state,
		started,
		ended: at,
		deadline: stage.deadline ?? deadlineOf(stage, started),
	};
}

/** `stage` as the page shows it at `now`: hung when under way past its deadline. */
export function shownStage(stage: Stage, now: number): Stage {
	return (stage.state === "running" || stage.state === "checking") &&
		stage.deadline !== null &&
		Date.parse(stage.deadline) < now
		? { ...stage, state: "hung" }
		: stage;
}

/** How long a step took, in milliseconds, once done. */
export function took(stage: Stage): number | null {
	return stage.state === "done" &&
		stage.started !== null &&
		stage.ended !== null
		? Date.parse(stage.ended) - Date.parse(stage.started)
		: null;
}

/** What each step is called. */
export const STAGE_NAMES: Record<StageKey, string> = {
	upstream: "Wait for upstream live",
	adopt: "Adopt",
	publish: "Publish",
	live: "Wait for own live",
	bump: "Bump task",
	gate: "Merge gate",
	merged: "Merged",
	push: "Push and verify",
	remote: "Release pushed",
	login: "npm sign-in",
	otp: "2FA",
	command: "Ship command",
	versions: "Versions checked",
};

/** How long each step is expected to take before any ship of it says. */
export const STAGE_DEFAULTS: Record<StageKey, Duration> = {
	upstream: Duration.mins(5),
	adopt: Duration.mins(10),
	publish: Duration.mins(5),
	live: Duration.mins(5),
	bump: Duration.mins(20),
	gate: Duration.mins(10),
	merged: Duration.ms(0),
	push: Duration.secs(30),
	remote: Duration.secs(30),
	login: Duration.mins(2),
	otp: Duration.mins(2),
	command: Duration.mins(5),
	versions: Duration.secs(1),
};

/** How long a step goes before it shows hung the first time, with no ship before to say. */
export const FIRST_DEADLINE = Duration.mins(10);

/** How many times its expected time a step goes before it shows hung. */
const DEADLINE_TIMES = 3;

/** The states a step ends in. */
export const STAGE_ENDED: StageState[] = ["done", "failed", "skipped"];
