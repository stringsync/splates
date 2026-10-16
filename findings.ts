import type { Judged } from "./adherence";
import type { TaskLog } from "./task-log";
import type { GateFailure } from "./worktree";

/** What went worse than it could have, in the order `Finding` lists the kinds. */
export function findings(evidence: Evidence): Finding[] {
	const found: Finding[] = evidence.gateFailures.map((each) => ({
		kind: "gate",
		...each,
	}));
	if (evidence.retries > 0) {
		found.push({ kind: "retried", times: evidence.retries });
	}
	const { log } = evidence;
	for (const at of log?.stopped ?? []) {
		found.push({ kind: "stopped", at });
	}
	for (const at of log?.interrupted ?? []) {
		found.push({ kind: "interrupted", at });
	}
	if (evidence.picksOverturned > 0) {
		found.push({ kind: "overturned", picks: evidence.picksOverturned });
	}
	if (evidence.assumptionsChallenged > 0) {
		found.push({
			kind: "challenged",
			assumptions: evidence.assumptionsChallenged,
		});
	}
	for (const [command, times] of Object.entries(log?.failedCommands ?? {})) {
		if (times >= FINDING_THRESHOLDS.repeatedFailures) {
			found.push({ kind: "repeated_failure", command, times });
		}
	}
	if (
		log !== null &&
		evidence.landedLines !== null &&
		log.editedLines >= FINDING_THRESHOLDS.churnLines &&
		log.editedLines > evidence.landedLines * FINDING_THRESHOLDS.churnRatio
	) {
		found.push({
			kind: "churn",
			edited: log.editedLines,
			landed: evidence.landedLines,
		});
	}
	for (const [check, { passed, failed }] of Object.entries(
		evidence.adherence?.scores ?? {},
	)) {
		if (
			failed > 0 &&
			passed / (passed + failed) < FINDING_THRESHOLDS.adherenceBelow
		) {
			found.push({ kind: "adherence", check, passed, failed });
		}
	}
	return found;
}

/**
 * Where a finding starts: each tuned here, so a finding that fires too often
 * or too rarely is one number to change.
 */
export const FINDING_THRESHOLDS = {
	/** A command failing this many times in one task. */
	repeatedFailures: 3,
	/** Lines edited this many times over the lines that landed. */
	churnRatio: 4,
	/** And at least this many lines edited, so a small task's retouching is not churn. */
	churnLines: 300,
	/** A skill check passed less than this share of the times it applied. */
	adherenceBelow: 0.5,
} as const;

/**
 * Something that went worse than it could have in one task, kept with what it
 * names, so a later count can tell how often each kind recurs.
 */
export type Finding =
	/** The gate turned it away, even once. */
	| ({ kind: "gate" } & GateFailure)
	/** `arbor retry` granted it more merge attempts. */
	| { kind: "retried"; times: number }
	/** The person stopped the agent's turn. */
	| { kind: "stopped"; at: string }
	/** A lost connection cut the agent's turn short. */
	| { kind: "interrupted"; at: string }
	/** The person answered picks with another choice than the agent's. */
	| { kind: "overturned"; picks: number }
	/** The person challenged assumptions the agent made. */
	| { kind: "challenged"; assumptions: number }
	/** One command failed again and again. */
	| { kind: "repeated_failure"; command: string; times: number }
	/** Far more lines edited than landed. */
	| { kind: "churn"; edited: number; landed: number }
	/** A skill check its conversation mostly failed. */
	| { kind: "adherence"; check: string; passed: number; failed: number };

/** What a task leaves to find in, each part absent when it was not kept. */
export interface Evidence {
	gateFailures: GateFailure[];
	retries: number;
	picksOverturned: number;
	assumptionsChallenged: number;
	log: TaskLog | null;
	/** Lines the landed diff added and removed; null when unknown. */
	landedLines: number | null;
	/** Its conversation's skill checks as last judged; null when unjudged. */
	adherence: Judged | null;
}
