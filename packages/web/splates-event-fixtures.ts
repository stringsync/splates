import { assumedEvent, overturnedEvent } from "./assumed-line";
import type { Named, SplatesEventView } from "./splates-event";
import type { WaitRequest } from "./wait-request";

/** One thing in the fixture thread: a turn of the person's or the agent's, or splates's. */
export type FixtureItem =
	| { kind: "user"; text: string }
	| { kind: "agent"; text: string }
	| { kind: "event"; event: SplatesEventView }
	| {
			kind: "wait";
			directive: string;
			wait: WaitRequest;
			at: string;
			outcome: string | null;
	  };

/**
 * A thread showing each kind of event, timed from `now`: plain ones, a merge
 * that failed and one that landed, a wait still counting and one that timed
 * out, a requested cred, a groom's burst of todo updates as one, and an
 * agent's wait on a task, still running, and on an idle machine, ended.
 */
export function fixtureThread(now: number): FixtureItem[] {
	const at = (mins: number) => new Date(now + mins * 60_000).toISOString();
	return [
		{ kind: "user", text: "[SPLATES TASK #225]" },
		{
			kind: "event",
			event: {
				words: ["Added", task("events-log")],
				at: at(-42),
			},
		},
		{
			kind: "agent",
			text: "The journal is a list of lines today; I'll give each kind of event its own type first.",
		},
		{
			kind: "event",
			event: {
				words: [
					"Updated",
					{
						kind: "todos",
						todos: [
							{ id: 212, subject: "Upload retries forever on a 413" },
							{ id: 214, subject: "Show a stale task as muted" },
							{ id: 219, subject: "Name the journal's event kinds" },
							{ id: 221, subject: "Drop the old upload endpoint" },
							{ id: 226, subject: "Count refused merges on Stats" },
						],
					},
				],
				at: at(-26),
			},
		},
		{
			kind: "event",
			event: {
				mark: "failed",
				words: ["Merge failed", task("events-log")],
				at: at(-12),
			},
		},
		{
			kind: "agent",
			text: "Rebased onto the lane's last merge; the conflict was the import order.",
		},
		{
			kind: "event",
			event: {
				mark: "failed",
				words: ["Wait timed out", task("events-look")],
				at: at(-4),
			},
		},
		{
			kind: "event",
			event: {
				words: ["Requested", { kind: "cred", name: "CLOUDFLARE_API_TOKEN" }],
				at: at(-3),
			},
		},
		{
			kind: "event",
			event: {
				words: ["Waiting on", task("events-log")],
				at: at(-1),
				deadline: { until: at(9) },
			},
		},
		{
			kind: "wait",
			directive: "[SPLATES WAIT task desktop-card-pager]",
			wait: { type: "task", task: "desktop-card-pager" },
			at: at(-36),
			outcome: null,
		},
		{
			kind: "wait",
			directive: "[SPLATES WAIT machine idle 2m]",
			wait: { type: "idle", duration: "2m" },
			at: at(-12),
			outcome: "The machine has stayed idle for 2m.",
		},
		{
			kind: "agent",
			text: "Retries failed scans three times before the dead-letter queue.",
		},
		{
			kind: "event",
			event: assumedEvent(
				{ assumed: "Retry limit: 3", alternative: "5", kind: "defaults" },
				{ label: "Overturn", run: () => {} },
			),
		},
		{
			kind: "event",
			event: assumedEvent(
				{
					assumed: "Backoff: linear",
					alternative: "exponential",
					kind: "design",
				},
				{ label: "Overturn", run: () => {}, done: "Overturned" },
			),
		},
		{
			kind: "event",
			event: overturnedEvent("Backoff: linear → exponential", at(-1)),
		},
		{
			kind: "event",
			event: {
				words: ["Questions answered"],
				act: { label: "Show", run: () => {} },
			},
		},
		{
			kind: "event",
			event: {
				words: ["Plan approved"],
				act: { label: "Show", run: () => {} },
			},
		},
		{
			kind: "event",
			event: {
				words: ["Removed", task("drag-cards")],
				at: at(-1),
			},
		},
		{
			kind: "event",
			event: {
				mark: "landed",
				words: ["Merged", task("events-log")],
				at: at(0),
			},
		},
	];
}

const task = (name: string): Extract<Named, { kind: "task" }> => ({
	kind: "task",
	task: name,
});
