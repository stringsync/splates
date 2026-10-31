import { join } from "node:path";

/** The checkout `splates dev` acts on: the one you are standing in, so in a worktree it is that worktree's own copy. */
export const ROOT = join(import.meta.dir, "../../..");
