import type { Git } from "./git";
import { Watched } from "./watched";
import { workerGit } from "./worker-git";
import type { WorkerMachine } from "./worker-machine";

/** The git `Watch` runs, on whichever machine the agent works: `Git` here, or a worker's. */
export type WatchGit = Pick<Git, "root" | "run" | "interruptedOps" | "at">;

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

/** What `Watch` tells of each command that moves the branch of the tree it runs in. */
export interface BranchMoves {
	/**
	 * The command committed, amended, squashed or rebased `branch`, which
	 * `at` reads, rooted at the tree it ran in on the machine it ran on.
	 */
	moved(branch: string, at: Git): void;
}

/**
 * Watches the commands agents run in one repository, `git.root` its main
 * tree, for what they did to git.
 */
export class Watch {
	constructor(
		private readonly git: WatchGit,
		/** Told of each command that moves its tree's branch; none by default. */
		private readonly moves: BranchMoves | null = null,
	) {}

	/**
	 * Starts watching a command run in `cwd`, looking at git as it stands:
	 * on `machine`, a remote worker the agent was placed on, in the clone at
	 * `cwd`, which holds its own stash and remotes and has no main tree
	 * beside it; else on the machine `git` runs on.
	 */
	command(cwd: string, machine: WorkerMachine | null = null): Watched {
		const git = machine === null ? this.git : workerGit(cwd, machine);
		return Watched.start(git, cwd, this.moves);
	}
}
