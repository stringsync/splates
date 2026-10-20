import { fail } from "../exit";
import type { GateFailure, MergeFailure, Worktree } from "../tasks";

/** Guards merge mutations and records refusals on the task that owns them. */
export class MergeState {
	constructor(private readonly worktree: Worktree) {}
	/** Git owns its lock: neither its age nor an absent open fd proves it stale. */
	async refuseIndexLock(
		output: string,
		conflicts: string[] = [],
	): Promise<void> {
		const worktree = await this.requireLease();
		if (
			conflicts.length > 0 ||
			!/Unable to create ['"].*[/\\]index\.lock['"]: File exists/i.test(output)
		) {
			return;
		}
		await worktree.take({ status: "working" });
		fail(
			"blocked",
			[
				"Git could not acquire index.lock; this is lock contention, not a content conflict. No merge attempt was spent.",
				indent(tail(output)),
				"Wait for the Git operation using this worktree to finish, then run `splates merge` again. Splates has left the lock untouched.",
				"If Git left a rebase in progress, finish it after the lock is released (`git rebase --continue`) before merging again.",
				"If it persists, investigate its owner before any manual recovery; never delete a lock held by a live operation.",
			].join("\n"),
			{ task: worktree.task },
		);
	}

	async bump(
		reason: MergeFailure,
		named: Omit<GateFailure, "reason" | "at">,
	): Promise<void> {
		const worktree = await this.requireLease();
		const by = worktree.state?.mergeFailuresBy ?? {};
		await worktree.take({
			status: "working",
			mergeAttempts: worktree.mergeAttempts + 1,
			mergeFailures: (worktree.state?.mergeFailures ?? 0) + 1,
			mergeFailuresBy: { ...by, [reason]: (by[reason] ?? 0) + 1 },
			gateFailures: [
				...(worktree.state?.gateFailures ?? []),
				{ reason, at: new Date().toISOString(), ...named },
			],
		});
	}
	/** Refuses to mutate or land a tree whose lease changed while checks ran. */
	async requireLease(): Promise<Worktree> {
		const current = await this.worktree.reload();
		if (!current.leaseOurs) {
			fail(
				"lease_lost",
				`the lease on '${this.worktree.task}' was taken by pid ${current.lease?.pid} during the merge, stopping without landing. Do not retry; another agent owns this tree.`,
				{ task: this.worktree.task, lease: current.lease },
			);
		}
		return current;
	}
}

function tail(output: string): string {
	return output.trim().split("\n").slice(-40).join("\n");
}

function indent(text: string): string {
	return text
		.split("\n")
		.map((line) => `    ${line}`)
		.join("\n");
}
