import type { GitResult } from "./git";
import type { WorktreeStore } from "./worktree-store";

/** The status a task's own record carries. */
export type RecordStatus = "working" | "grafting" | "escalated";

/** What a task's record stores about who is driving it. */
export interface LeaseState {
	pid: number;
	hostname: string;
	heartbeatAt: string;
}

export interface Escalation {
	reason: string;
	at: string;
}

export interface TaskState {
	task: string;
	branch: string;
	worktree: string;
	status: RecordStatus;
	lease: LeaseState | null;
	graftAttempts: number;
	createdAt: string;
	updatedAt: string;
	escalations?: Escalation[];
}

/**
 * Everything a name can turn out to be. The record's own status when the
 * workstream is intact, and otherwise the way in which it is not.
 */
export type WorktreeStatus =
	| RecordStatus
	| "absent" // nothing under this name, and no memory of one
	| "pruned" // discarded earlier; still remembered
	| "orphaned" // a record whose directory is gone
	| "stray" // a leftover branch, with no directory or record
	| "unrecorded" // a directory with no record
	| "unknown"; // a record that would not parse

/** What the store found on disk. */
export interface WorktreeSnapshot {
	task: string;
	branch: string;
	path: string;
	state: TaskState | null;
	exists: boolean;
	hasBranch: boolean;
	prunedAt: string | null;
	corrupt: boolean;
}

/**
 * One workstream, whether or not it is still there. Commands ask the store for
 * one of these and read its status rather than assembling the same handful of
 * existence checks themselves.
 */
export class Worktree {
	constructor(
		private readonly store: WorktreeStore,
		private readonly snapshot: WorktreeSnapshot,
	) {}

	get task(): string {
		return this.snapshot.task;
	}

	get branch(): string {
		return this.snapshot.branch;
	}

	get path(): string {
		return this.snapshot.path;
	}

	get state(): TaskState | null {
		return this.snapshot.state;
	}

	get lease(): LeaseState | null {
		return this.snapshot.state?.lease ?? null;
	}

	/**
	 * Live means a fresh heartbeat and, when the holder is on this host, a pid
	 * that still exists. The pid check matters because every arbor command is
	 * its own short-lived process: without it a tree would stay locked for the
	 * whole staleness window after a command that merely finished, and `create`
	 * would block the `graft` that follows it.
	 */
	get leaseLive(): boolean {
		const { lease } = this;
		const { ps, config } = this.store;
		if (!lease) {
			return false;
		}
		if (Date.now() - Date.parse(lease.heartbeatAt) >= config.leaseStalenessMs) {
			return false;
		}
		return lease.hostname === ps.hostname ? ps.alive(lease.pid) : true;
	}

	get leaseOurs(): boolean {
		const { ps } = this.store;
		return this.lease?.pid === ps.pid && this.lease.hostname === ps.hostname;
	}

	/** Someone else is driving this tree right now. */
	get leaseHeld(): boolean {
		return this.leaseLive && !this.leaseOurs;
	}

	get graftAttempts(): number {
		return this.snapshot.state?.graftAttempts ?? 0;
	}

	/** Whether the working directory itself is on disk. */
	get exists(): boolean {
		return this.snapshot.exists;
	}

	get hasBranch(): boolean {
		return this.snapshot.hasBranch;
	}

	/** When this task was pruned, if it was and nothing has replaced it. */
	get prunedAt(): string | null {
		return this.snapshot.prunedAt;
	}

	get status(): WorktreeStatus {
		const { state, exists, hasBranch, prunedAt, corrupt } = this.snapshot;
		if (corrupt) {
			return "unknown";
		}
		if (state) {
			return exists ? state.status : "orphaned";
		}
		if (exists) {
			return "unrecorded";
		}
		if (hasBranch) {
			return "stray";
		}
		return prunedAt ? "pruned" : "absent";
	}

	/** Nothing is left under this name — nothing to claim, nothing to remove. */
	get gone(): boolean {
		return this.status === "absent" || this.status === "pruned";
	}

	/**
	 * Merges changes into the record and writes it. Works on a name that has no
	 * record yet, which is how `create` writes the first one and how `claim`
	 * rebuilds one from a worktree found on disk.
	 */
	async save(changes: Partial<TaskState> = {}): Promise<Worktree> {
		const now = new Date().toISOString();
		const state: TaskState = {
			task: this.task,
			branch: this.branch,
			worktree: this.path,
			status: "working",
			lease: null,
			graftAttempts: 0,
			createdAt: now,
			...(this.snapshot.state ?? {}),
			...changes,
			updatedAt: now,
		};
		await this.store.saveRecord(state);
		return new Worktree(this.store, {
			...this.snapshot,
			state,
			corrupt: false,
		});
	}

	/** `save`, taking the lease for this process. */
	take(changes: Partial<TaskState> = {}): Promise<Worktree> {
		const { ps } = this.store;
		return this.save({
			...changes,
			lease: {
				pid: ps.pid,
				hostname: ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});
	}

	/** Re-reads from disk. `graft` needs this: the record is the truth. */
	reload(): Promise<Worktree> {
		return this.store.find(this.task);
	}

	/** Removes the directory, the branch, and the record; remembers the name. */
	discard(): Promise<GitResult> {
		return this.store.discard(this);
	}

	commitsAhead(): Promise<number | null> {
		return this.store.git.commitsAhead(this.store.trunk, this.branch);
	}

	diffStat(): Promise<{ added: number; removed: number } | null> {
		return this.store.git.diffStat(this.store.trunk, this.branch);
	}

	uncommitted(): Promise<string[]> {
		return this.store.git.porcelain(this.path);
	}

	interruptedOps(): Promise<string[]> {
		return this.store.git.interruptedOps(this.path);
	}
}
