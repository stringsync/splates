import type { Automation } from "./store";

/** What a run the person asked for was set off by, as its run lists it. */
export const BY_HAND = "by hand";

/**
 * Whether `automation` can be run at once by hand: one on a schedule, or the
 * groomer, which grooms the backlog as it stands. One on any other task
 * event needs the event's tasks, so it runs only on that event.
 */
export function runsNow({
	trigger,
	hook,
}: Pick<Automation, "trigger" | "hook">): boolean {
	return !("event" in trigger) || hook.kind === "groom";
}
