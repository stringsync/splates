import { resolve } from "node:path";
import type { Fs, Ps } from "@webappwiz/sys";
import type { Config } from "./arbor";
import type { Git, GitResult } from "./git";
import { type TaskState, Worktree } from "./worktree";

// ponytail: a flat cap on remembered names, no age policy. The memory only
// answers "was this task pruned before?", so losing the oldest costs a nicer
// message and nothing else. Make it a config key if anyone wants more depth.
const REMEMBER = 50;

const BRANCH_PREFIX = "task/";

/**
 * Where workstreams live and everything persistent about them: the worktree
 * directories, the records under `.git/arbor/tasks`, and the names of tasks
 * already pruned. One name, one lookup, whatever state it turns out to be in.
 */
export class WorktreeStore {
	private readonly tasksDir: string;
	private readonly prunedDir: string;

	constructor(
		private readonly fs: Fs,
		readonly ps: Ps,
		readonly git: Git,
		readonly config: Config,
		arborDir: string,
		private readonly remember = REMEMBER,
	) {
		this.tasksDir = `${arborDir}/tasks`;
		this.prunedDir = `${arborDir}/pruned`;
	}

	async init(): Promise<void> {
		await this.fs.mkdir(this.tasksDir);
		await this.fs.mkdir(this.prunedDir);
	}

	get trunk(): string {
		return this.config.trunk;
	}

	/**
	 * Worktrees are siblings of the repo, not nested inside it, so editors and
	 * test runners don't walk into five copies of the tree.
	 */
	pathFor(task: string): string {
		return resolve(this.config.worktreeRoot, task);
	}

	branchFor(task: string): string {
		return `${BRANCH_PREFIX}${task}`;
	}

	/** The task a branch belongs to, or null if it is not a task branch. */
	taskFor(branch: string): string | null {
		return branch.startsWith(BRANCH_PREFIX)
			? branch.slice(BRANCH_PREFIX.length)
			: null;
	}

	/** Deterministic, so a task keeps its port across restarts and machines. */
	portFor(task: string): number {
		const [start, end] = this.config.portRange;
		let hash = 0;
		for (const char of task) {
			hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
		}
		return start + (hash % (end - start + 1));
	}

	recordPath(task: string): string {
		return `${this.tasksDir}/${task}.json`;
	}

	/** Always answers; the returned worktree's status says what was found. */
	async find(task: string): Promise<Worktree> {
		let state: TaskState | null = null;
		let corrupt = false;
		try {
			state = await this.readRecord(task);
		} catch {
			corrupt = true; // a record that will not parse is still a record
		}
		const path = state?.worktree ?? this.pathFor(task);
		const exists = await this.fs.exists(path);
		const hasBranch = await this.git.branchExists(this.branchFor(task));
		return new Worktree(this, {
			task,
			branch: state?.branch ?? this.branchFor(task),
			path,
			state,
			exists,
			hasBranch,
			corrupt,
			// Only worth asking when there is nothing else left of the task.
			prunedAt:
				state || exists || hasBranch || corrupt
					? null
					: await this.prunedAt(task),
		});
	}

	async list(): Promise<Worktree[]> {
		const entries = await this.fs.readdir(this.tasksDir).catch(() => []);
		const tasks = entries
			.filter((e) => e.endsWith(".json"))
			.map((e) => e.slice(0, -".json".length))
			.sort();
		const found: Worktree[] = [];
		for (const task of tasks) {
			found.push(await this.find(task));
		}
		return found;
	}

	/** Adds the branch and the working directory. The record comes after. */
	async create(task: string): Promise<GitResult> {
		await this.fs.mkdir(this.config.worktreeRoot);
		return this.git.addWorktree(
			this.branchFor(task),
			this.pathFor(task),
			this.config.trunk,
		);
	}

	async discard(worktree: Worktree): Promise<GitResult> {
		const removed = worktree.exists
			? await this.git.removeWorktree(worktree.path)
			: // Directory gone by other means: drop the metadata git still holds.
				await this.git.pruneWorktrees();
		if (removed.code !== 0) {
			return removed;
		}
		if (worktree.hasBranch) {
			const deleted = await this.git.deleteBranch(worktree.branch);
			if (deleted.code !== 0) {
				return deleted;
			}
		}
		await this.fs.rm(this.recordPath(worktree.task), { force: true });
		await this.rememberPruned(worktree.task);
		return removed;
	}

	/**
	 * Writes to a temp path in the same directory, then renames. A half-written
	 * record read by a concurrent agent is a real failure mode, and rename is
	 * the only way to make the swap atomic.
	 */
	async saveRecord(state: TaskState): Promise<void> {
		const path = this.recordPath(state.task);
		const tmp = `${path}.${this.ps.pid}.tmp`;
		await this.fs.write(tmp, `${JSON.stringify(state, null, "\t")}\n`);
		await this.fs.rename(tmp, path);
	}

	private async readRecord(task: string): Promise<TaskState | null> {
		const raw = await this.fs.read(this.recordPath(task)).catch(() => null);
		return raw === null ? null : (JSON.parse(raw) as TaskState);
	}

	private prunedPath(task: string): string {
		return `${this.prunedDir}/${task}`;
	}

	private async prunedAt(task: string): Promise<string | null> {
		const raw = await this.fs.read(this.prunedPath(task)).catch(() => null);
		return raw?.trim() ?? null;
	}

	/**
	 * Remembers a pruned name so a second `prune` can say "already pruned"
	 * instead of "never existed", then drops the oldest so the list of
	 * remembered names cannot grow without bound.
	 */
	private async rememberPruned(
		task: string,
		at = new Date().toISOString(),
	): Promise<void> {
		await this.fs.write(this.prunedPath(task), `${at}\n`);
		const names = await this.fs.readdir(this.prunedDir).catch(() => []);
		if (names.length <= this.remember) {
			return;
		}
		// Each file holds the ISO timestamp it was written with, which sorts
		// chronologically. An unreadable one sorts first and goes first.
		const dated = await Promise.all(
			names.map(async (name) => ({
				name,
				at: (await this.prunedAt(name)) ?? "",
			})),
		);
		dated.sort((a, b) => a.at.localeCompare(b.at));
		for (const { name } of dated.slice(0, names.length - this.remember)) {
			await this.fs.rm(this.prunedPath(name), { force: true });
		}
	}
}
