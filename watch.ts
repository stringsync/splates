import type { Git } from "./git";
import { Watched } from "./watched";

/** The git `Watch` runs, on whichever machine the agent works: `Git` here, or a worker's. */
export type WatchGit = Pick<Git, "root" | "run" | "interruptedOps">;

/**
 * Something a command did to git that an agent should not have, judged by
 * what it did rather than what it said: one that stashes and pops again, or
 * commits and squashes, did nothing worth a flag.
 */
export type Flag =
	/** Stashed `count` changes and left them there. */
	| { type: "stashed"; count: number }
	/** Took commits off `branch` that its tree no longer holds. */
	| { type: "dropped"; branch: string }
	/** Checked out `now`, a branch or null for a detached HEAD, off `branch`. */
	| { type: "left"; branch: string; now: string | null }
	/** Pushed, updating these remote branches, in a command that says `push`. */
	| { type: "pushed"; refs: string[] }
	/** Changed these files in the main tree, from a task's worktree. */
	| { type: "outside"; paths: string[] };
/**
 * Watches the commands agents run in one repository, `git.root` its main
 * tree, for what they did to git.
 */
export class Watch {
	constructor(private readonly git: WatchGit) {}

	/** Starts watching a command run in `cwd`, looking at git as it stands. */
	command(cwd: string): Watched {
		return Watched.start(this.git, cwd);
	}
}
