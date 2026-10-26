import type { Action, Event } from "@stringsync/splates-server/records";

/**
 * How loudly an event shows in a conversation. A loud one keeps a line of its
 * own among the work: it changes what the conversation is about or needs the
 * person. A quiet one has no line; it joins the work row it fell in, as a
 * count that opens to it. To add an action, put it in the tier its line would
 * deserve: one the person must see or act on is loud.
 */
export type Tier = "loud" | "quiet";

/**
 * The tier of `event`, or null for one that shows nowhere: a bare
 * `splates attach` that only listed, a request for creds that asked nothing,
 * or an action the conversation has no word for.
 */
export function tierOf(event: Event): Tier | null {
	const { action } = event;
	if (action === "creds request") {
		return event.reason !== null ? "quiet" : event.asked ? "loud" : null;
	}
	if (action === "add" && event.reason === null && event.agent !== null) {
		return "quiet";
	}
	if (ALWAYS_LOUD.has(action)) {
		return "loud";
	}
	if (
		LOUD.has(action) &&
		!(event.reason !== null && QUIET_WHEN_REFUSED.has(action))
	) {
		return "loud";
	}
	if (action === "attach" && event.reason === null) {
		return (event.stored?.length ?? 0) + (event.removed?.length ?? 0) === 0
			? null
			: "quiet";
	}
	// Any other refused command is quiet; the agent says why itself.
	return QUIET.has(action) || event.reason !== null ? "quiet" : null;
}

/** Actions that are loud whether they went through or were refused. */
const ALWAYS_LOUD = new Set<Action>([
	"wait",
	"task wait",
	"creds wait",
	"creds request",
	"merge queued",
	"merge start",
]);

/** Actions loud when they went through, and, for all but `add`, when refused: the failure changes what happens next. */
const LOUD = new Set<Action>([
	"add",
	"claim",
	"merge",
	"remove",
	"handoff",
	"retry",
	"escalate",
]);

/** Loud actions whose refusal is only a quiet note. */
const QUIET_WHEN_REFUSED = new Set<Action>(["add"]);

/** Actions that are always quiet. */
const QUIET = new Set<Action>([
	"task add",
	"task update",
	"task take",
	"task release",
	"task remove",
	"queue add",
	"queue remove",
	"lane add",
	"lane update",
	"lane remove",
	"attach",
	"artifact add",
	"artifact remove",
	"auto",
]);
