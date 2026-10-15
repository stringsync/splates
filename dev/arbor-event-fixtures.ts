import type { ArborEventView, Named } from "./arbor-event";

/** One thing in the fixture thread: a turn of the person's or the agent's, or arbor's. */
export type FixtureItem =
	| { kind: "user"; text: string }
	| { kind: "agent"; text: string }
	| { kind: "event"; event: ArborEventView };

/**
 * A thread showing each kind of event, timed from `now`: plain ones, a merge
 * that failed and one that landed, a wait still counting and one that timed
 * out, a requested cred, and a groom's burst of todo updates as one.
 */
export function fixtureThread(now: number): FixtureItem[] {
	const at = (mins: number) => new Date(now + mins * 60_000).toISOString();
	return [
		{ kind: "user", text: "[ARBOR TODO #225]" },
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
							{ id: 214, subject: "Show a stale todo as muted" },
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
			kind: "event",
			event: {
				mark: "landed",
				words: ["Merged", task("events-log")],
				at: at(0),
			},
		},
		{
			kind: "event",
			event: {
				words: [
					"Handed off",
					{ ...task("events-look"), note: "handed to codex (gpt-5.5)" },
				],
				at: at(1),
			},
		},
		{
			kind: "event",
			event: { words: ["Took over", task("events-look")], at: at(2) },
		},
	];
}

const task = (name: string): Extract<Named, { kind: "task" }> => ({
	kind: "task",
	task: name,
});
