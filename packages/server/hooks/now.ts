import type { Automation } from "./store";

/** What a run the person asked for was set off by, as its run lists it. */
export const BY_HAND = "by hand";

/**
 * Whether `automation` can be run at once by hand: one on a schedule. One on
 * a task event needs the event's tasks, so it runs only on that event.
 */
export function runsNow({ trigger }: Pick<Automation, "trigger">): boolean {
	return !("event" in trigger) && !("signal" in trigger);
}
