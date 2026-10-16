import { type FileDiff, parseDiff } from "./diff";
import type { GitResult } from "./git";
import type { WorktreeService } from "./worktree-service";

/**
 * One task, whether or not it is still there. Commands ask the service for
 * one of these and read its status rather than assembling the same handful of
 * existence checks themselves.
 */
export class Worktree {
	// scry-ignore classes-over-function-exports: the service is what hands out Worktrees, so the two are one design in two files, and an interface here would have one implementation and still expose the service's Git
	constructor(
		private readonly service: WorktreeService,
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
		return this.snapshot.state?.base ?? this.service.trunk;
	}

	/** The conversation whose agent added the task, or null. */
	get caller(): string | null {
		return this.snapshot.state?.caller ?? null;
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

	/** The `arbor dev` conversation whose agent last took the task, or null. */
	get takenBy(): string | null {
		return this.lease?.conversation ?? null;
	}

	get leaseHeld(): boolean {
		// On this host the pid alone decides. Every arbor command is its own
		// short-lived process, so a lease goes stale the moment its command
		// exits, and nothing refreshes the heartbeat while one runs: judged by
		// age, a merge whose test gate outlasts the staleness window could be
		// claimed out from under it. The heartbeat only judges a holder on
		// another host, whose pid cannot be checked.
		const { lease } = this;
		const { ps, config } = this.service;
		if (!lease) {
			return false;
		}
		if (lease.hostname === ps.hostname) {
			return ps.alive(lease.pid);
		}
		return Date.now() - Date.parse(lease.heartbeatAt) < config.leaseStalenessMs;
	}

	get leaseStatus(): "held" | "stale" | "none" {
		return !this.lease ? "none" : this.leaseHeld ? "held" : "stale";
	}

	get leaseOurs(): boolean {
		const { ps } = this.service;
		return this.lease?.pid === ps.pid && this.lease.hostname === ps.hostname;
	}

	get leaseHeldByOther(): boolean {
		return this.leaseHeld && !this.leaseOurs;
	}

	get mergeAttempts(): number {
		return this.snapshot.state?.mergeAttempts ?? 0;
	}

	/** How many merge attempts a task gets before `merge` stops on `budget_exhausted`. */
	get mergeAttemptLimit(): number {
		return this.service.config.mergeRetryCount;
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
		await this.service.saveRecord(state);
		return new Worktree(this.service, {
			...this.snapshot,
			state,
			corrupt: false,
		});
	}

	async take(changes: Partial<TaskState> = {}): Promise<Worktree> {
		const { ps } = this.service;
		const conversation = await this.service.conversation();
		return this.save({
			...changes,
			lease: {
				pid: ps.pid,
				hostname: ps.hostname,
				heartbeatAt: new Date().toISOString(),
				...(conversation === undefined ? {} : { conversation }),
			},
		});
	}

	/** Re-reads from disk. `merge` needs this: the record is the truth. */
	reload(): Promise<Worktree> {
		return this.service.find(this.task);
	}

	/**
	 * Removes the directory, the branch, and the record; remembers the name,
	 * and how the task ended.
	 */
	discard(
		ended: "merged" | "removed",
		opts: DiscardOptions = {},
	): Promise<GitResult> {
		return this.service.discard(this, ended, opts);
	}

	/** The message of each commit it has that its base does not, oldest first. */
	commitMessages(): Promise<string[] | null> {
		return this.service.git.commitMessages(this.base, this.branch);
	}

	commitsAhead(): Promise<number | null> {
		return this.service.git.commitsAhead(this.base, this.branch);
	}

	/** Files and lines across all its pending work, as `diff` shows it; null without a branch. */
	async size(): Promise<DiffSize | null> {
		const files = await this.diff();
		return (
			files && {
				files: files.length,
				added: files.reduce((sum, file) => sum + file.added, 0),
				removed: files.reduce((sum, file) => sum + file.removed, 0),
			}
		);
	}

	/**
	 * Its committed and uncommitted changes, new files among them, parsed;
	 * null without a branch.
	 */
	async diff(): Promise<FileDiff[] | null> {
		const diff = await this.service.git.diff(
			this.base,
			this.branch,
			this.exists ? this.path : null,
		);
		return (
			diff &&
			parseDiff(diff.text).map((file) => ({
				...file,
				uncommitted: diff.uncommitted.includes(file.path),
			}))
		);
	}

	/** Committed and uncommitted paths this task touches; null without a branch. */
	changedFiles(): Promise<string[] | null> {
		return this.service.git.changedFiles(
			this.base,
			this.branch,
			this.exists ? this.path : null,
		);
	}

	uncommitted(): Promise<string[]> {
		return this.service.git.porcelain(this.path);
	}

	/** When its branch's latest commit was made, or null without a branch. */
	committedAt(): Promise<string | null> {
		return this.service.git.committedAt(this.branch);
	}

	interruptedOps(): Promise<string[]> {
		return this.service.git.interruptedOps(this.path);
	}
}

export interface DiscardOptions {
	/**
	 * The `arbor dev` conversation working on it, when ended from the page
	 * rather than by the agent, whose env names it.
	 */
	conversation?: string;
	/**
	 * The repo-relative paths the task changed, for a merge, which reads them
	 * before landing leaves nothing between the branch and its base. Read
	 * from the branch when not given.
	 */
	changed?: string[];
	/**
	 * The message of each commit a merge lands, read before landing as
	 * `changed` is.
	 */
	commits?: string[];
	/** Why it was removed, as `arbor remove --reason` gives it. */
	reason?: RemoveReason;
	/** What a merge lands, read before landing as `changed` is. */
	size?: DiffSize;
}

/** How big a change is, as its diff counts it. */
export interface DiffSize {
	files: number;
	added: number;
	removed: number;
}

/** Why a task can be removed rather than merged, as `--reason` names it. */
export const REMOVE_REASONS = [
	"nothing",
	"moot",
	"superseded",
	"redo",
] as const;

/** Why a task was removed rather than merged. */
export type RemoveReason = (typeof REMOVE_REASONS)[number];

/** The status a task's own record carries. */
export type RecordStatus = "working" | "merging" | "escalated";

/** What a task's record stores about who is driving it. */
export interface LeaseState {
	pid: number;
	hostname: string;
	heartbeatAt: string;
	/**
	 * The `arbor dev` conversation whose agent took it, or its caller's for a
	 * subagent; absent for an agent outside the page, and in older records.
	 */
	conversation?: string;
}

export interface Escalation {
	reason: string;
	at: string;
	/**
	 * Set for a task handed over to be approved rather than to answer
	 * questions, the reason saying what to look at.
	 */
	// Records from before reviews were a state hold the number of the
	// question that asked, `"4"`.
	review?: true | string;
	/**
	 * When `claim` took the task back up, ending the wait on a person; absent
	 * while it waits, and in records from before it was kept.
	 */
	resumedAt?: string;
}

/** Why a merge failed, as `merge` refuses it. */
export type MergeFailure = "conflict" | "tests_failed" | "merge_failed";

/** A test the gate named as failing, and what it said, as far as the runner printed. */
export interface FailedTest {
	name: string;
	message: string;
}

/** One time `merge` turned a task away, and what it said of why. */
export interface GateFailure {
	reason: MergeFailure | "budget_exhausted";
	at: string;
	/** The files the rebase conflicted in, for a conflict. */
	files?: string[];
	/** The tests the gate named as failing, for `tests_failed`. */
	tests?: string[];
	/** Those tests with what each said, for `tests_failed`. Absent in old records. */
	failures?: FailedTest[];
	/** What git said, for `merge_failed`. */
	error?: string;
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
	/**
	 * Every merge that failed, which `retry` leaves alone while it hands back
	 * the attempts. Absent in old records: none counted yet.
	 */
	mergeFailures?: number;
	/** `mergeFailures` by why each failed. Absent in old records. */
	mergeFailuresBy?: Partial<Record<MergeFailure, number>>;
	/**
	 * Each time the gate turned it away, oldest first, with what it named:
	 * every failed merge, and each refusal once its attempts ran out. Absent in
	 * old records.
	 */
	gateFailures?: GateFailure[];
	/** How many times `arbor retry` granted it more attempts. Absent in old records. */
	retries?: number;
	createdAt: string;
	updatedAt: string;
	escalations?: Escalation[];
	/**
	 * The agent `arbor add --agent` or `arbor handoff` handed the task to, for
	 * `arbor dev` to start.
	 */
	dispatch?: Dispatched;
	/**
	 * The `arbor dev` conversation whose agent added the task, which the page
	 * nests it under. Absent for one added outside a conversation, or before
	 * tasks remembered it.
	 */
	caller?: string;
}

/**
 * Who `arbor add --agent` or `arbor handoff` handed a task to. `arbor dev` starts the agent in
 * the task's tree and writes down the conversation it started, so it starts
 * once.
 */
export interface Dispatched {
	agent: string;
	/** The model to pick, by the session's model setting; absent, the agent's own. */
	model?: string;
	/** What the agent is told beyond claiming the task. */
	prompt?: string;
	/** The conversation `arbor dev` started, once it has. */
	conversation?: string;
	/**
	 * Set while the postCheckout hook readies the tree; `arbor dev` starts the
	 * agent once it clears.
	 */
	// Recorded from the start, so the task reads as handed over rather than
	// an external agent's.
	pending?: true;
	/**
	 * Set when the agent at work on the task handed it on with `arbor
	 * handoff`, so the one started is told `[ARBOR HANDOFF <task>]`.
	 */
	handoff?: true;
	/**
	 * Whether the agent started answers to the task's caller rather than the
	 * person, as for `arbor handoff --relay`. Absent in records written
	 * before it was kept, when a handoff with a caller always relayed.
	 */
	relay?: boolean;
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

/** What the service found on disk. */
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
