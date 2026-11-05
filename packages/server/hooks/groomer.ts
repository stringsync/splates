import type { Trigger } from "./store";

/** The built-in automation the groomer runs as, once turned on from the Automations page. */
export const GROOMER_AUTOMATION = "groomer";

/**
 * What wakes the groomer: a task added, which waits in Backlog for a lane
 * until it is groomed.
 */
export const GROOMER_TRIGGER: Trigger = { event: "task.created" };
