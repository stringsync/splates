import { join } from "node:path";

/** Resolve repository commands against this checkout, including its worktrees. */
export const ROOT = join(import.meta.dir, "..");
