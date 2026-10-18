import { join } from "node:path";

/**
 * The checkout this `splates dev` runs from, which `bin/_run` picks as the one you
 * are standing in: a git worktree's own copy, so testing it tests your work.
 */
export const ROOT = join(import.meta.dir, "../../..");
