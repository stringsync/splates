import { resolve } from "node:path";
import { type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";
import type { Config } from "./config";
import type { Git, GitResult } from "./git";
import { type TaskState, Worktree } from "./worktree";

const BRANCH_PREFIX = "task/";

export interface AddOptions {
	/** Branch the new worktree starts from. Defaults to the trunk. */
	base?: string;
}

/**
 * Where tasks live and everything persistent about them: the worktree
 * directories, the records under `.git/arbor/tasks`, and the names of tasks
 * already removed. One name, one lookup, whatever state it turns out to be in.
 */
/** What a `WorktreeService` works through; the real ones by default. */
export interface WorktreeServiceOptions {
	fs?: Fs;
	ps?: Ps;
}

export class WorktreeService {
	private readonly tasksDir: string;
	private readonly removedDir: string;
	private readonly fs: Fs;
	readonly ps: Ps;

	// rule-ignore classes-over-function-exports: Git is the only way arbor speaks git and a second implementation is not coming, which one-dir-per-interface says is when not to write the interface; tests run the real Git against a throwaway repo rather than faking twenty methods
	constructor(
		readonly git: Git,
		readonly config: Config,
		arborDir: string,
		opts: WorktreeServiceOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
		this.ps = opts.ps ?? new NodePs();
		this.tasksDir = `${arborDir}/tasks`;
		this.removedDir = `${arborDir}/removed`;
	}

	async init(): Promise<void> {
		await this.fs.mkdir(this.tasksDir);
		await this.fs.mkdir(this.removedDir);
	}

	get trunk(): string {
		return this.config.get("trunk");
	}

	/** Where a task's worktree lives: a sibling of the repo, never inside it. */
	pathFor(task: string): string {
		return resolve(this.config.get("worktreeRoot"), task);
	}

	branchFor(task: string): string {
		return `${BRANCH_PREFIX}${task}`;
	}

	taskFor(branch: string): string | null {
		return branch.startsWith(BRANCH_PREFIX)
			? branch.slice(BRANCH_PREFIX.length)
			: null;
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
			removedAt:
				state || exists || hasBranch || corrupt
					? null
					: await this.removedAt(task),
		});
	}

	async list(): Promise<Worktree[]> {
		const entries = await this.fs.readdir(this.tasksDir).catch(() => []);
		const tasks = entries
			.filter((entry) => entry.endsWith(".json"))
			.map((entry) => entry.slice(0, -".json".length))
			.sort();
		const found: Worktree[] = [];
		for (const task of tasks) {
			found.push(await this.find(task));
		}
		return found;
	}

	/** Adds the branch and the working directory. The record comes after. */
	async add(
		task: string,
		{ base = this.config.get("trunk") }: AddOptions = {},
	): Promise<GitResult> {
		await this.fs.mkdir(this.config.get("worktreeRoot"));
		return this.git.addWorktree(this.branchFor(task), this.pathFor(task), base);
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
		await this.rememberRemoved(worktree.task);
		return removed;
	}

	/** Writes a task's record. A concurrent reader sees the old one or the new. */
	async saveRecord(state: TaskState): Promise<void> {
		// A half-written record read by a concurrent agent is a real failure mode,
		// and rename is the only way to make the swap atomic.
		const path = this.recordPath(state.task);
		const tmp = `${path}.${this.ps.pid}.tmp`;
		await this.fs.write(tmp, `${JSON.stringify(state, null, "\t")}\n`);
		await this.fs.rename(tmp, path);
	}

	private async readRecord(task: string): Promise<TaskState | null> {
		const raw = await this.fs.read(this.recordPath(task)).catch(() => null);
		return raw === null ? null : (JSON.parse(raw) as TaskState);
	}

	private removedPath(task: string): string {
		return `${this.removedDir}/${task}`;
	}

	private async removedAt(task: string): Promise<string | null> {
		const raw = await this.fs.read(this.removedPath(task)).catch(() => null);
		return raw?.trim() ?? null;
	}

	/**
	 * Remembers a removed name so a second `rm` can say "already removed"
	 * instead of "never existed", then drops the oldest so the list of
	 * remembered names cannot grow without bound.
	 */
	private async rememberRemoved(
		task: string,
		at = new Date().toISOString(),
	): Promise<void> {
		const removedCapacity = this.config.get("removedCapacity");
		await this.fs.write(this.removedPath(task), `${at}\n`);
		const names = await this.fs.readdir(this.removedDir).catch(() => []);
		if (names.length <= removedCapacity) {
			return;
		}
		// Each file holds the ISO timestamp it was written with, which sorts
		// chronologically. An unreadable one sorts first and goes first.
		const dated = await Promise.all(
			names.map(async (name) => ({
				name,
				at: (await this.removedAt(name)) ?? "",
			})),
		);
		dated.sort((left, right) => left.at.localeCompare(right.at));
		for (const { name } of dated.slice(0, names.length - removedCapacity)) {
			await this.fs.rm(this.removedPath(name), { force: true });
		}
	}
}
