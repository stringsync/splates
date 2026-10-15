import { relative, resolve, sep } from "node:path";
import { type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";
import { Attachments } from "./attachments";
import type { Config } from "./config";
import type { Git, GitResult } from "./git";
import { ranWith } from "./models";
import { type Outcomes, promptsFrom } from "./outcomes";
import { assumptionCounts, PLAN_FILE, picks } from "./plan";
import { Systems } from "./systems";
import { type DiscardOptions, type TaskState, Worktree } from "./worktree";

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
	/** Where each task's ending is written down; none, and nothing is. */
	outcomes?: Outcomes;
}

export class WorktreeService {
	private readonly tasksDir: string;
	private readonly removedDir: string;
	private readonly conversationsDir: string;
	private readonly fs: Fs;
	private readonly outcomes: Outcomes | null;
	readonly ps: Ps;

	// scry-ignore classes-over-function-exports: Git is the only way arbor speaks git and a second implementation is not coming, so there is no interface to write; tests run the real Git against a throwaway repo rather than faking twenty methods
	constructor(
		readonly git: Git,
		readonly config: Config,
		arborDir: string,
		opts: WorktreeServiceOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
		this.ps = opts.ps ?? new NodePs();
		this.outcomes = opts.outcomes ?? null;
		this.tasksDir = `${arborDir}/tasks`;
		this.removedDir = `${arborDir}/removed`;
		this.conversationsDir = `${arborDir}/conversations`;
	}

	/**
	 * The `arbor dev` conversation whose agent runs this command, when it is
	 * one of this repo's: an agent from another project's page working here
	 * is, to this repo, an agent outside the page.
	 */
	async conversation(): Promise<string | undefined> {
		const id = this.ps.env("ARBOR_CONVERSATION");
		return id !== undefined &&
			(await this.fs.exists(`${this.conversationsDir}/${id}.jsonl`))
			? id
			: undefined;
	}

	async init(): Promise<void> {
		await this.fs.mkdir(this.tasksDir);
		await this.fs.mkdir(this.removedDir);
		await this.sweep();
	}

	get trunk(): string {
		return this.config.trunk;
	}

	/** Where a task's worktree lives: a sibling of the repo, never inside it. */
	pathFor(task: string): string {
		return resolve(this.config.worktreeRoot, task);
	}

	branchFor(task: string): string {
		return `${BRANCH_PREFIX}${task}`;
	}

	taskFor(branch: string | null): string | null {
		return branch?.startsWith(BRANCH_PREFIX)
			? branch.slice(BRANCH_PREFIX.length)
			: null;
	}

	recordPath(task: string): string {
		return `${this.tasksDir}/${task}.json`;
	}

	/**
	 * Where a task's files live, beside its record: the screenshots and videos
	 * its questions show, in `tasks/<task>/`. They go when the task does.
	 */
	files(task: string): Attachments {
		return new Attachments(`${this.tasksDir}/${task}`, this.fs);
	}

	/**
	 * Whether `path` is a file some task holds: one level inside a task's
	 * folder, so never a record, and not a way out of here.
	 */
	owns(path: string): boolean {
		const inside = relative(this.tasksDir, resolve(path));
		return !inside.startsWith("..") && inside.split(sep).length === 2;
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
		const entries: string[] = await this.fs
			.readdir(this.tasksDir)
			.catch(() => []);
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
		{ base = this.config.trunk }: AddOptions = {},
	): Promise<GitResult> {
		await this.fs.mkdir(this.config.worktreeRoot);
		return this.git.addWorktree(this.branchFor(task), this.pathFor(task), base);
	}

	async discard(
		worktree: Worktree,
		ended: "merged" | "removed",
		opts: DiscardOptions = {},
	): Promise<GitResult> {
		// What the outcome reads off the tree and branch, before they go.
		const ending = await this.ending(worktree, opts);
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
		await this.files(worktree.task).clear();
		await this.rememberRemoved(worktree.task);
		await this.recordOutcome(worktree, ended, opts, ending);
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

	/**
	 * Writes down how a task with a record ended. One with none, a stray
	 * branch or a bare directory, never ran as a task, so says nothing.
	 */
	/**
	 * What a task leaves to read as it ends: its plan's questions, and the
	 * systems its changes fall in, by the config in its own tree.
	 */
	private async ending(
		worktree: Worktree,
		{ changed }: DiscardOptions,
	): Promise<Ending> {
		if (!this.outcomes || !worktree.state) {
			return { plan: "", systems: [] };
		}
		const paths =
			changed ??
			(worktree.hasBranch ? await worktree.changedFiles() : null) ??
			[];
		const root = worktree.exists ? worktree.path : this.git.root;
		const systems = await Systems.at(root, { fs: this.fs }).catch(() => null);
		return {
			plan: worktree.exists
				? await this.fs.read(`${worktree.path}/${PLAN_FILE}`).catch(() => "")
				: "",
			systems: systems?.touchedBy(paths).map((each) => each.name) ?? [],
		};
	}

	private async recordOutcome(
		{ task, base, state }: Worktree,
		ended: "merged" | "removed",
		opts: DiscardOptions,
		ending: Ending,
	): Promise<void> {
		if (!this.outcomes || !state) {
			return;
		}
		const escalations = state.escalations ?? [];
		const endedAt = new Date().toISOString();
		const asked = picks(ending.plan);
		const assuming = assumptionCounts(ending.plan);
		const reviews = escalations.filter((each) => each.review).length;
		// A dispatched task names its conversation once `arbor dev` started
		// it; any other agent from the page has it in its env.
		const conversation =
			opts.conversation ??
			state.dispatch?.conversation ??
			this.ps.env("ARBOR_CONVERSATION") ??
			null;
		// What the conversation ran is what did the work; the handover only
		// says what was asked for, and is all an unstarted one has.
		const log =
			conversation === null
				? null
				: `${this.conversationsDir}/${conversation}.jsonl`;
		const ran = log === null ? null : await ranWith(log, this.fs);
		await this.outcomes.record({
			project: this.git.root,
			task,
			base,
			ended,
			startedAt: state.createdAt,
			endedAt,
			questionRounds: escalations.length - reviews,
			reviewRounds: reviews,
			failedMerges: state.mergeFailures ?? 0,
			failedMergesBy: state.mergeFailuresBy ?? {},
			questionsAsked: asked.asked,
			picksAsked: asked.picked,
			picksOverturned: asked.overturned,
			picksAmended: asked.amended,
			assumptionsMade: assuming.made,
			assumptionsChallenged: assuming.challenged,
			systems: ending.systems,
			// Each escalation waits until claimed, or until the task ended
			// while it still waited.
			waitedMs: escalations.reduce(
				(sum, each) =>
					sum +
					Math.max(
						0,
						Date.parse(each.resumedAt ?? endedAt) - Date.parse(each.at),
					),
				0,
			),
			removedFor: ended === "removed" ? (opts.reason ?? null) : null,
			...(opts.commits === undefined ? {} : { commits: opts.commits }),
			promptsFrom:
				log === null
					? {}
					: await promptsFrom(log, this.fs, state.createdAt, endedAt),
			conversation,
			agent: ran?.agent ?? state.dispatch?.agent ?? null,
			model: ran?.model ?? state.dispatch?.model ?? null,
		});
	}

	private async readRecord(task: string): Promise<TaskState | null> {
		const raw = await this.fs.read(this.recordPath(task)).catch(() => null);
		return raw === null ? null : (JSON.parse(raw) as TaskState);
	}

	/**
	 * Drops the files of every task with no record left: what a process that
	 * died between discarding a task and clearing its folder left behind.
	 */
	private async sweep(): Promise<void> {
		const entries: string[] = await this.fs
			.readdir(this.tasksDir)
			.catch(() => []);
		for (const entry of entries) {
			const path = `${this.tasksDir}/${entry}`;
			if (
				entries.includes(`${entry}.json`) ||
				!(await this.fs.stat(path).catch(() => null))?.isDirectory()
			) {
				continue;
			}
			await this.fs.rm(path, { recursive: true, force: true });
		}
	}

	private removedPath(task: string): string {
		return `${this.removedDir}/${task}`;
	}

	private async removedAt(task: string): Promise<string | null> {
		const raw = await this.fs.read(this.removedPath(task)).catch(() => null);
		return raw?.trim() ?? null;
	}

	/**
	 * Remembers a removed name so a second `remove` can say "already removed"
	 * instead of "never existed", then drops the oldest so the list of
	 * remembered names cannot grow without bound.
	 */
	private async rememberRemoved(
		task: string,
		at = new Date().toISOString(),
	): Promise<void> {
		const { removedCapacity } = this.config;
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

/** What `discard` reads off a task for its outcome before the tree goes. */
interface Ending {
	plan: string;
	systems: string[];
}
