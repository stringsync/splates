import type { GitResult } from "./git";
import type { WatchGit } from "./watch";
import type { WorkerMachine } from "./worker-machine";

/**
 * The git `Watch` runs around an agent's commands, run on the worker the
 * agent works on, since its worktree is there.
 */
export class WorkerGit implements WatchGit {
	constructor(
		/** The main worktree, where trunk lives. */
		readonly root: string,
		private readonly machine: WorkerMachine,
	) {}

	run(cwd: string, ...args: string[]): Promise<GitResult> {
		return this.machine.git(cwd, args);
	}

	/** As `Git.interruptedOps`, read on the worker: a worktree's half-finished merges and rebases. */
	async interruptedOps(worktree: string): Promise<string[]> {
		const pointer = await this.machine
			.read(`${worktree}/.git`, 0)
			.catch(() => null);
		const dir =
			pointer === null || pointer.size === 0
				? null
				: new TextDecoder()
						.decode(pointer.bytes)
						.trim()
						.replace(/^gitdir:\s*/, "");
		if (dir === null) {
			return [];
		}
		const found: string[] = [];
		for (const [entry, description] of CHECKS) {
			if (await this.machine.exists(`${dir}/${entry}`)) {
				found.push(description);
			}
		}
		return [...new Set(found)];
	}
}

/** What `Git.interruptedOps` looks for in a worktree's git directory. */
const CHECKS: [string, string][] = [
	["rebase-merge", "rebase in progress"],
	["rebase-apply", "rebase in progress"],
	["MERGE_HEAD", "merge in progress"],
	["CHERRY_PICK_HEAD", "cherry-pick in progress"],
];
