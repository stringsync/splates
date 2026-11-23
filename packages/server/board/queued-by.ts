/**
 * The root of an agent-queued task chain: the user-started conversation or
 * task at the top of the tree.
 */
export interface ChainRoot {
	/** The conversation at the top of the chain. */
	conversation: string;
	/** The worktree task slug at the top of the chain, or null for the main tree. */
	task: string | null;
	/** The board task number the root took, when it took one. */
	boardTask?: number;
}

/**
 * Who queued a task: the person directly, a lane they queued, or an agent
 * under the project's agent auto-queue setting.
 */
export type QueuedBy =
	| { by: "person" }
	| { by: "lane"; lane: number }
	| {
			by: "agent";
			/** The conversation whose agent queued this task. */
			conversation: string;
			/** The worktree task slug that queued it, or null from the main tree. */
			task: string | null;
			/** The board task number the caller took, when it took one. */
			fromTask?: number;
			/** The chain root: the user-started conversation/task at the top. */
			root: ChainRoot;
	  };
