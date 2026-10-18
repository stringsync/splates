import type { Git, GitResult } from "./git";

/** Where a worker's project clone names the mirror its clones borrow objects from. */
export const MIRROR_KEY = "splates.mirror";

/**
 * Where a task clone names the project clone it was made from, which
 * `openRepository` takes as its main tree, as a worktree's is.
 */
export const HOME_KEY = "splates.home";

/**
 * How a task's checkout is made and taken away. The local worker's are
 * worktrees of the main tree, sharing its branches; a remote worker's are
 * clones, each holding its own, so the rest of splates reads a task's branch
 * through the `Git` `gitOf` gives it rather than the main tree's.
 */
export interface Checkouts {
	/** Makes `branch` from `base` and checks it out at `path`. */
	add(
		task: string,
		branch: string,
		path: string,
		base: string,
	): Promise<GitResult>;
	/**
	 * Makes a checkout of `task` at `path` again from its pushed branch, on
	 * a machine that has none, with `base` beside it.
	 */
	resume(
		task: string,
		branch: string,
		path: string,
		base: string,
	): Promise<GitResult>;
	/** Takes the checkout at `path` away, and `branch` with it. */
	remove(path: string, branch: string): Promise<GitResult>;
	/** The git a checkout at `path` reads its branch through. */
	gitOf(path: string): Git;
}
