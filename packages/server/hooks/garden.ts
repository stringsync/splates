import type { Trigger } from "./store";

/** The built-in automation the notes gardener runs as, once turned on from the Automations page. */
export const GARDENER_AUTOMATION = "notes-gardener";

/** What the gardener's automation was named while it only audited, which a saved one still reads as. */
export const AUDIT_AUTOMATION = "notes-audit";

/** How often the notes gardener runs until the person sets another schedule: weekly, since each run reads code for every note. */
export const GARDENER_TRIGGER: Trigger = { every: "7d" };
