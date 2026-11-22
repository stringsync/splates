import type { SignalOverview } from "@splates/server/signals";
import { ago, errored, everyOf, timeLeft } from "./signal-of";
import { liveCount, removalOf } from "./signal-summary";

/**
 * How a signal stands at a glance: `polling` while its poll script is on,
 * `passed` once a poll passed, `broken` when its last poll errored,
 * `stopped` once polling ended without passing, `removed`, and `quiet` for
 * a signal with no poll script, which only fires.
 */
export type SignalTone =
	| "polling"
	| "passed"
	| "broken"
	| "stopped"
	| "removed"
	| "quiet";

/** A signal's standing in words: its tone, a headline and what follows it. */
export interface SignalStatus {
	tone: SignalTone;
	/** The outcome, in a word or two: `Not yet`, `Passed`, `Fired 4m ago`. */
	headline: string;
	/** When, in a few words: `last poll 38s ago · next in 22s · every 1m`. */
	when: string;
	/** The index's short form: `Polling · not yet · 38s ago`. */
	short: string;
}

const ENDED: Record<string, string> = {
	"timed out": "Polling timed out",
	orphaned: "Polling stopped",
	stopped: "Polling stopped",
	replaced: "Replaced by a newer poll script",
};

/** What `signal` says now, for its row in the index and the top of its page. */
export function statusOf(signal: SignalOverview, now: number): SignalStatus {
	const reason = removalOf(signal);
	if (reason !== undefined) {
		return {
			tone: "removed",
			headline: "Removed",
			when: reason,
			short: `Removed · ${reason}`,
		};
	}
	const { probe } = signal;
	if (probe === null) {
		return firingStatus(signal, now);
	}
	const last = probe.runs.at(-1);
	const polls = `${probe.count} ${probe.count === 1 ? "poll" : "polls"}`;
	if (probe.state === "idle") {
		return {
			tone: "polling",
			headline: "Ready",
			when: `first poll once a wait begins · every ${everyOf(probe.everyMs)}`,
			short: "Ready · first poll once a wait begins",
		};
	}
	if (probe.state === "running") {
		const next =
			probe.next === undefined ? "" : ` · next in ${timeLeft(probe.next, now)}`;
		if (last === undefined) {
			return {
				tone: "polling",
				headline: "Not polled yet",
				when: `first poll${next} · every ${everyOf(probe.everyMs)}`,
				short: "Polling · not polled yet",
			};
		}
		const broke = errored(last);
		const said = broke ? `Errored, exit ${last.exit}` : "Not yet";
		return {
			tone: broke ? "broken" : "polling",
			headline: said,
			when: `last poll ${ago(last.at, now)}${next} · every ${everyOf(probe.everyMs)}`,
			short: `Polling · ${said.toLowerCase()} · ${ago(last.at, now)}`,
		};
	}
	if (probe.state === "raised") {
		const at = last?.at ?? probe.endedAt;
		const when = at === undefined ? "" : ago(at, now);
		return {
			tone: "passed",
			headline: "Passed",
			when: `last poll ${when} · after ${polls}`,
			short: `Poll passed · ${when}`,
		};
	}
	const ended = ENDED[probe.state] ?? "Polling stopped";
	const passedNone = probe.runs.every((run) => run.exit !== 0);
	return {
		tone: "stopped",
		headline: ended,
		when:
			last === undefined
				? "never polled"
				: `last poll ${ago(last.at, now)} · ${polls}${passedNone ? ", none passed" : ""}`,
		short: `${ended} · ${polls}${passedNone && last !== undefined ? ", none passed" : ""}`,
	};
}

function firingStatus(signal: SignalOverview, now: number): SignalStatus {
	const latest = signal.raises[0];
	if (latest === undefined) {
		const waited = liveCount(signal) > 0;
		return {
			tone: "quiet",
			headline: "Not fired this week",
			when: waited ? "waited on, nothing polls for it" : "nothing waits on it",
			short: waited ? "Waited on · not fired yet" : "Not fired this week",
		};
	}
	const times = `${signal.raises.length} ${signal.raises.length === 1 ? "time" : "times"} this week`;
	return {
		tone: "quiet",
		headline: `Fired ${ago(latest.at, now)}`,
		when: `by ${latest.by} · ${times}`,
		short: `Fired by ${latest.by}`,
	};
}

/** Whether `signal` is on now: polling, or something waits on or runs from it. */
export function isLive(signal: SignalOverview): boolean {
	const state = signal.probe?.state;
	return state === "running" || state === "idle" || liveCount(signal) > 0;
}
