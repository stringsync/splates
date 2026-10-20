import type { Trigger } from "./store";

/** The built-in automation the notes audit runs as, once turned on from the Automations page. */
export const AUDIT_AUTOMATION = "notes-audit";

/** How often the notes audit runs until the person sets another schedule: weekly, since each run reads code for every note. */
export const AUDIT_TRIGGER: Trigger = { every: "7d" };
