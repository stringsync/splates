import type { Trigger } from "./store";

/** The built-in automation the groomer runs as, once turned on from the Automations page. */
export const GROOMER_AUTOMATION = "groomer";

/**
 * What wakes the groomer: a task added, to the backlog for grooming, or
 * ready and Untriaged for a lane.
 */
export const GROOMER_TRIGGER: Trigger = { event: "task.created" };
