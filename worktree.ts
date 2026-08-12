import type { GitResult } from "./git";
import type { WorktreeStore } from "./worktree-store";

/** The status a task's own record carries. */
export type RecordStatus = "working" | "merging" | "escalated";

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
	/** The branch this task lands on. Absent in old records: trunk. */
	base?: string;
	status: RecordStatus;
	lease: LeaseState | null;
	mergeAttempts: number;
	createdAt: string;
	updatedAt: string;
	escalations?: Escalation[];
}

/**
 * Everything a name can turn out to be. The record's own status when the
 * task is intact, and otherwise the way in which it is not.
 */
export type WorktreeStatus =
	| RecordStatus
	| "absent" // nothing under this name, and no memory of one
	| "removed" // discarded earlier; still remembered
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
	removedAt: string | null;
	corrupt: boolean;
}

/**
 * One task, whether or not it is still there. Commands ask the store for
 * one of these and read its status rather than assembling the same handful of
 * existence checks themselves.
 */
export class Worktree {
	// lint-ignore classes-over-function-exports: the store is what hands out
	// Worktrees, so the two are one design in two files. An interface here would
	// have a single implementation and still have to expose the store's Git.
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

	/** Where this task's work lands: its recorded base branch, else trunk. */
	get base(): string {
		return this.snapshot.state?.base ?? this.store.trunk;
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

	get leaseHeld(): boolean {
		// The pid check matters because every arbor command is its own short-lived
		// process: without it a tree would stay locked for the whole staleness
		// window after a command that merely finished, and `add` would block the
		// `merge` that follows it.
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

	get leaseStatus(): "held" | "stale" | "none" {
		return !this.lease ? "none" : this.leaseHeld ? "held" : "stale";
	}

	get leaseOurs(): boolean {
		const { ps } = this.store;
		return this.lease?.pid === ps.pid && this.lease.hostname === ps.hostname;
	}

	get leaseHeldByOther(): boolean {
		return this.leaseHeld && !this.leaseOurs;
	}

	get mergeAttempts(): number {
		return this.snapshot.state?.mergeAttempts ?? 0;
	}

	get exists(): boolean {
		return this.snapshot.exists;
	}

	get hasBranch(): boolean {
		return this.snapshot.hasBranch;
	}

	get removedAt(): string | null {
		return this.snapshot.removedAt;
	}

	get status(): WorktreeStatus {
		const { state, exists, hasBranch, removedAt, corrupt } = this.snapshot;
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
		return removedAt ? "removed" : "absent";
	}

	get gone(): boolean {
		return this.status === "absent" || this.status === "removed";
	}

	/**
	 * Merges changes into the record and writes it. Works on a name that has no
	 * record yet, which is how `add` writes the first one and how `claim`
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
			mergeAttempts: 0,
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

	/** Re-reads from disk. `merge` needs this: the record is the truth. */
	reload(): Promise<Worktree> {
		return this.store.find(this.task);
	}

	/** Removes the directory, the branch, and the record; remembers the name. */
	discard(): Promise<GitResult> {
		return this.store.discard(this);
	}

	commitsAhead(): Promise<number | null> {
		return this.store.git.commitsAhead(this.base, this.branch);
	}

	diffStat(): Promise<{ added: number; removed: number } | null> {
		return this.store.git.diffStat(this.base, this.branch);
	}

	uncommitted(): Promise<string[]> {
		return this.store.git.porcelain(this.path);
	}

	interruptedOps(): Promise<string[]> {
		return this.store.git.interruptedOps(this.path);
	}
}
