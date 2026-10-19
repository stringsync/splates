import { relative, resolve, sep } from "node:path";
import { type Fs, MemoryLock, NodeFs, NodePs, type Ps } from "webappwiz/system";
import { Attachments, folderBytes } from "../artifacts";
import { TaskStore } from "../board";
import type { Config } from "../config";
import type { Git, GitResult } from "../git";
import { limited, READ_CONCURRENCY } from "../limited";
import type { Checkouts } from "../merge";
import { ranWith } from "../models";
import { decisions, goalLine, Plans, picks } from "../plans";
import type { Adherence } from "../stats";
import { findings, type Outcomes, promptsFrom, taskLog } from "../stats";
import type { WorkerMachine } from "../workers";
import { WorkerBudget, workerGit } from "../workers";
import { Finished } from "./finished";
import type { LeaseBeat } from "./lease-beat";
import { StartedRecords } from "./started-records";
import {
	type DiffSize,
	type DiscardOptions,
	type TaskState,
	Worktree,
} from "./worktree";
import { WorktreeCheckouts } from "./worktree-checkouts";

const BRANCH_PREFIX = "task/";

/** The task `branch` is the branch of, or null for any other branch. */
export function taskOf(branch: string | null): string | null {
	return branch?.startsWith(BRANCH_PREFIX)
		? branch.slice(BRANCH_PREFIX.length)
		: null;
}

export interface AddOptions {
	/** Branch the new worktree starts from. Defaults to the trunk. */
	base?: string;
}

/**
 * Where tasks live and everything persistent about them: the worktree
 * directories, the records under `.git/splates/tasks`, and the names of tasks
 * already removed. One name, one lookup, whatever state it turns out to be in.
 */
export class WorktreeService {
	private readonly tasksDir: string;
	private readonly records: StartedRecords;
	private readonly removedDir: string;
	private readonly conversationsDir: string;
	private readonly plansDir: string;
	/** Every task that merged or was removed here, newest kept, to look back on. */
	readonly finished: Finished;
	private readonly fs: Fs;
	private readonly outcomes: Outcomes | null;
	private readonly adherence: Adherence | null;
	private readonly workerBudget: string | null;
	private readonly leases: LeaseBeat | null;
	private readonly worktrees: WorktreeCheckouts;
	private readonly clones: { checkouts: Checkouts; machine: string } | null;
	private readonly machines: WorkerMachines | null;
	readonly ps: Ps;

	// scry-ignore classes-over-function-exports: Git is the only way splates speaks git and a second implementation is not coming, so there is no interface to write; tests run the real Git against a throwaway repo rather than faking twenty methods
	constructor(
		readonly git: Git,
		readonly config: Config,
		splatesDir: string,
		opts: WorktreeServiceOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
		this.ps = opts.ps ?? new NodePs();
		this.outcomes = opts.outcomes ?? null;
		this.adherence = opts.adherence ?? null;
		this.workerBudget = opts.workerBudget ?? null;
		this.leases = opts.leases ?? null;
		this.worktrees = new WorktreeCheckouts(git, this.fs);
		this.clones = opts.clones ?? null;
		this.machines = opts.machines ?? null;
		this.tasksDir = `${splatesDir}/tasks`;
		this.records = new StartedRecords(
			opts.store ?? new TaskStore(this.tasksDir, new MemoryLock(), this.fs),
			this.fs,
		);
		this.removedDir = `${splatesDir}/removed`;
		this.conversationsDir = `${splatesDir}/conversations`;
		this.plansDir = `${splatesDir}/plans`;
		this.finished = new Finished(
			`${splatesDir}/finished`,
			this.fs,
			config.finishedCapacity,
		);
	}

	/**
	 * The `splates server` conversation whose agent runs this command, when it is
	 * one of this repo's: an agent from another project's page working here
	 * is, to this repo, an agent outside the page.
	 */
	async conversation(): Promise<string | undefined> {
		const id = this.ps.env("SPLATES_CONVERSATION");
		return id !== undefined && (await this.holds(id)) ? id : undefined;
	}

	/** Where the log of the conversation `id` is kept. */
	conversationLog(id: string): string {
		return `${this.conversationsDir}/${id}.jsonl`;
	}

	/** Whether the `splates server` conversation `id` is one of this repo's. */
	holds(id: string): Promise<boolean> {
		return this.fs.exists(`${this.conversationsDir}/${id}.jsonl`);
	}

	/** Keeps `task`'s lease fresh while this process runs, once it has taken it. */
	held(task: string): void {
		this.leases?.held(this, task);
	}

	async init(): Promise<void> {
		await this.fs.mkdir(this.tasksDir);
		await this.fs.mkdir(this.removedDir);
		await this.records.sweep();
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
		return taskOf(branch);
	}

	/**
	 * Where a started task's files live, beside its record: the screenshots
	 * and videos its questions show, in `tasks/<N>/started/`, apart from those
	 * it was queued with. They go when the task ends. Null for a task with
	 * no record.
	 */
	files(task: string): Promise<Attachments | null> {
		return this.records.files(task);
	}

	/**
	 * Where a task's files live when it attaches them from `conversation`:
	 * beside that conversation's artifacts, in `attached/<task>/`, so they
	 * outlive the task and a merged card's images still show.
	 */
	attached(conversation: string, task: string): Attachments {
		return new Attachments(
			`${this.conversationsDir}/${conversation}/attached/${task}`,
			this.fs,
		);
	}

	/**
	 * Every folder holding files `task` attached: its own, and one in each
	 * conversation that attached some.
	 */
	async filesOf(task: string): Promise<Attachments[]> {
		const own = await this.files(task);
		const folders = own === null ? [] : [own];
		const entries = await this.fs
			.readdir(this.conversationsDir)
			.catch(() => []);
		for (const entry of entries.filter((each) => !each.endsWith(".jsonl"))) {
			const folder = this.attached(entry, task);
			if ((await folder.held()).length > 0) {
				folders.push(folder);
			}
		}
		return folders;
	}

	/**
	 * The bytes `conversation` keeps on disk, its artifacts and attached
	 * files, which together are held to `artifactConversationCapacity`.
	 */
	conversationBytes(conversation: string): Promise<number> {
		return folderBytes(this.fs, `${this.conversationsDir}/${conversation}`);
	}

	/**
	 * Whether `path` is a file some task or conversation holds for a task:
	 * one level inside a started task's folder, or inside a conversation's
	 * `attached/<task>/`, never a record or log, and not a way out of here.
	 */
	owns(path: string): boolean {
		const parts = relative(this.tasksDir, resolve(path)).split(sep);
		if (!parts.includes("..") && parts.length === 3 && parts[1] === "started") {
			return true;
		}
		const inside = relative(this.conversationsDir, resolve(path)).split(sep);
		return (
			!inside.includes("..") && inside.length === 4 && inside[1] === "attached"
		);
	}

	/** Always answers; the returned worktree's status says what was found. */
	async find(task: string): Promise<Worktree> {
		return this.found(task, await this.readRecord(task));
	}

	/** `task` as `find` gives it, its record already read. */
	private async found(
		task: string,
		state: TaskState | null,
	): Promise<Worktree> {
		// A record that will not parse has no name to be found by.
		const corrupt = false;
		const path = state?.worktree ?? this.pathFor(task);
		const branch = state?.branch ?? this.branchFor(task);
		const machine =
			(state === null ? this.clones?.machine : state.machine) ?? null;
		const reach = this.reach(machine, path, branch);
		const exists = await reach.exists();
		const hasBranch = await reach.git.branchExists(branch);
		return new Worktree(this, {
			task,
			branch,
			path,
			state,
			exists,
			hasBranch,
			corrupt,
			machine,
			git: reach.git,
			// Only worth asking when there is nothing else left of the task.
			removedAt:
				state || exists || hasBranch || corrupt
					? null
					: await this.removedAt(task),
		});
	}

	async list(): Promise<Worktree[]> {
		const states = (await this.records.all()).sort((left, right) =>
			left.task.localeCompare(right.task),
		);
		return limited(states, READ_CONCURRENCY, (state) =>
			this.found(state.task, state),
		);
	}

	/** Adds the branch and the working directory. The record comes after. */
	async add(
		task: string,
		{ base = this.config.trunk }: AddOptions = {},
	): Promise<GitResult> {
		await this.fs.mkdir(this.config.worktreeRoot);
		return (this.clones?.checkouts ?? this.worktrees).add(
			task,
			this.branchFor(task),
			this.pathFor(task),
			base,
		);
	}

	/**
	 * Whether `worktree`'s checkout is somewhere this machine cannot work
	 * in, though a clone of it can be made here again: on another worker,
	 * or gone from this one.
	 */
	elsewhere(worktree: Worktree): boolean {
		return (
			this.clones !== null &&
			worktree.state !== null &&
			(worktree.machine !== this.clones.machine || !worktree.exists)
		);
	}

	/**
	 * Clones `worktree` here again from its pushed branch, as a remote
	 * worker resumes a task whose checkout was on another worker, or was
	 * swept from this one, and points its record at the new clone.
	 */
	async resume(worktree: Worktree): Promise<GitResult> {
		if (this.clones === null) {
			return this.worktrees.resume(worktree.task);
		}
		const path = this.pathFor(worktree.task);
		await this.fs.rm(path, { recursive: true, force: true });
		const resumed = await this.clones.checkouts.resume(
			worktree.task,
			worktree.branch,
			path,
			worktree.base,
		);
		if (resumed.code === 0) {
			await worktree.save({ worktree: path, machine: this.clones.machine });
		}
		return resumed;
	}

	async discard(
		worktree: Worktree,
		ended: "merged" | "removed",
		opts: DiscardOptions = {},
	): Promise<GitResult> {
		// What the outcome reads off the tree and branch, before they go.
		const ending = await this.ending(worktree, opts);
		const plan = await this.finalPlan(worktree);
		const record = await this.records.ending(worktree.task);
		const removed = await this.reach(
			worktree.machine,
			worktree.path,
			worktree.branch,
		).remove();
		if (removed.code !== 0) {
			return removed;
		}
		await this.records.end(worktree.task);
		await this.rememberRemoved(worktree.task);
		if (record !== null && worktree.state) {
			await this.finished.record({
				id: record.id,
				task: worktree.task,
				subject: goalLine(plan) ?? (record.subject || worktree.task),
				ended,
				reason: ended === "removed" ? (opts.reason ?? null) : null,
				base: worktree.base,
				commit: opts.commit ?? null,
				startedAt: worktree.state.createdAt,
				endedAt: new Date().toISOString(),
				conversation:
					opts.conversation ?? worktree.state.dispatch?.conversation ?? null,
				took: record.took,
				plan,
			});
		}
		await this.recordOutcome(worktree, ended, ending, opts);
		return removed;
	}

	/**
	 * How to read and remove the checkout at `path`: a worktree of the main
	 * tree for a null `machine`; else a clone, on this machine when it is
	 * this worker, or on the worker `machine` as the coordinator holds it.
	 * One on a worker nobody here reaches is taken to be there still, and
	 * left for that worker's disk, a cache, to lose.
	 */
	private reach(machine: string | null, path: string, branch: string): Reach {
		if (machine === null) {
			return {
				git: this.git,
				exists: () => this.fs.exists(path),
				remove: () => this.worktrees.remove(path, branch),
			};
		}
		if (machine === this.clones?.machine) {
			const { checkouts } = this.clones;
			return {
				git: checkouts.gitOf(path),
				exists: () => this.fs.exists(path),
				remove: () => checkouts.remove(path, branch),
			};
		}
		const worker = this.machines?.machine(machine) ?? null;
		return {
			git: worker === null ? this.git.at(path) : workerGit(path, worker),
			exists: async () =>
				worker === null ? true : worker.exists(path).catch(() => true),
			remove: async () => {
				await worker?.removeCheckout(path).catch(() => {});
				return { code: 0, stdout: "", stderr: "" };
			},
		};
	}

	/**
	 * Writes what a started task's record holds, leaving what the list holds
	 * of it alone.
	 */
	saveRecord(state: TaskState): Promise<void> {
		return this.records.save(state);
	}

	/**
	 * Writes down how a task with a record ended. One with none, a stray
	 * branch or a bare directory, never ran as a task, so says nothing.
	 */
	/**
	 * What a task leaves to read as it ends: its plan's questions and diff size.
	 */
	private async ending(
		worktree: Worktree,
		{ size }: DiscardOptions,
	): Promise<Ending> {
		if (!this.outcomes || !worktree.state) {
			return { plan: "", size: null };
		}
		return {
			plan: worktree.exists
				? ((await new Plans(this.fs).read(worktree.path)) ?? "")
				: "",
			size: size ?? (worktree.hasBranch ? await worktree.size() : null) ?? null,
		};
	}

	/**
	 * The `SPLATES.md` a task ends on: its tree's, or the copy kept in repo
	 * state for a tree on a worker; "" for none.
	 */
	private async finalPlan(worktree: Worktree): Promise<string> {
		const own = worktree.exists
			? await new Plans(this.fs).read(worktree.path)
			: null;
		return (
			own ??
			(await this.fs
				.read(`${this.plansDir}/${worktree.task}.md`)
				.catch(() => "")) ??
			""
		);
	}

	private async recordOutcome(
		{ task, base, state }: Worktree,
		ended: "merged" | "removed",
		ending: Ending,
		opts: DiscardOptions,
	): Promise<void> {
		if (!this.outcomes || !state) {
			return;
		}
		const escalations = state.escalations ?? [];
		const endedAt = new Date().toISOString();
		const asked = picks(ending.plan);
		const reviews = escalations.filter((each) => each.review).length;
		const legacy = escalations.length > 0;
		// A dispatched task names its conversation once `splates server` started
		// it; any other agent from the page has it in its env.
		const conversation =
			opts.conversation ??
			state.dispatch?.conversation ??
			this.ps.env("SPLATES_CONVERSATION") ??
			null;
		// What the conversation ran is what did the work; the handover only
		// says what was asked for, and is all an unstarted one has.
		const log =
			conversation === null
				? null
				: `${this.conversationsDir}/${conversation}.jsonl`;
		const ran = log === null ? null : await ranWith(log, this.fs);
		const worked =
			log === null
				? null
				: await taskLog(log, this.fs, state.createdAt, endedAt);
		const judged =
			conversation === null || this.adherence === null
				? null
				: ((await this.adherence.list()).find(
						(each) => each.conversation === conversation,
					) ?? null);
		const workerSpend =
			this.workerBudget === null
				? null
				: (await WorkerBudget.open(this.workerBudget, this.fs)).spentOn(
						this.git.root,
						task,
						Date.parse(state.createdAt),
						Date.parse(endedAt),
					);
		await this.outcomes.record({
			project: this.git.root,
			task,
			base,
			ended,
			startedAt: state.createdAt,
			endedAt,
			// A task begun before escalating was retired counts its
			// escalations; any other, the turns its log shows asking.
			questionRounds: legacy
				? escalations.length - reviews
				: (worked?.questionRounds ?? 0),
			reviewRounds: legacy ? reviews : (worked?.reviewRounds ?? 0),
			failedMerges: state.mergeFailures ?? 0,
			failedMergesBy: state.mergeFailuresBy ?? {},
			questionsAsked: asked.asked,
			picksAsked: asked.picked,
			picksOverturned: asked.overturned,
			picksAmended: asked.amended,
			decisions: decisions(ending.plan),
			waitedMs: legacy
				? // Each escalation waits until claimed, or until the task
					// ended while it still waited.
					escalations.reduce(
						(sum, each) =>
							sum +
							Math.max(
								0,
								Date.parse(each.resumedAt ?? endedAt) - Date.parse(each.at),
							),
						0,
					)
				: (worked?.waitedMs ?? 0),
			removedFor: ended === "removed" ? (opts.reason ?? null) : null,
			...(opts.commits === undefined ? {} : { commits: opts.commits }),
			promptsFrom:
				log === null
					? {}
					: await promptsFrom(log, this.fs, state.createdAt, endedAt),
			...(worked === null
				? {}
				: { usage: worked.usage, workedMs: worked.workedMs }),
			...(workerSpend === null
				? {}
				: {
						workerSpend: {
							dollars: workerSpend.dollars,
							slotHours: workerSpend.slotHours,
							estimate: workerSpend.estimate,
						},
					}),
			...(ending.size === null ? {} : { size: ending.size }),
			findings: findings({
				gateFailures: state.gateFailures ?? [],
				retries: state.retries ?? 0,
				picksOverturned: asked.overturned,
				log: worked,
				landedLines:
					ending.size === null ? null : ending.size.added + ending.size.removed,
				adherence: judged,
				testTimes: opts.testTimes ?? [],
			}),
			conversation,
			agent: ran?.agent ?? state.dispatch?.agent ?? null,
			model: ran?.model ?? state.dispatch?.model ?? null,
		});
	}

	private readRecord(task: string): Promise<TaskState | null> {
		return this.records.find(task);
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
	/** What it landed or would have; null when there is no branch to read. */
	size: DiffSize | null;
}

/** The workers a coordinator holds, by id. */
export interface WorkerMachines {
	/** The worker `id`, or null when none by that id has joined. */
	machine(id: string): WorkerMachine | null;
}

/** Where a task's checkout is, and how to read it there. */
interface Reach {
	git: Git;
	exists(): Promise<boolean>;
	/** Takes the checkout away, and its branch with it. */
	remove(): Promise<GitResult>;
}

/** What a `WorktreeService` works through; the real ones by default. */
export interface WorktreeServiceOptions {
	fs?: Fs;
	ps?: Ps;
	/** Where each task's ending is written down; none, and nothing is. */
	outcomes?: Outcomes;
	/** How closely conversations follow the skill, which an ending's findings read. */
	adherence?: Adherence;
	/** The worker budget's ledger, which an ending reads what made workers cost it from. */
	workerBudget?: string;
	/**
	 * What keeps the leases this process takes fresh while it runs, for a
	 * command on a worker; none on the coordinator's machine, where a pid
	 * judges its holder.
	 */
	leases?: LeaseBeat;
	/**
	 * How this machine checks tasks out when it is a remote worker: clones,
	 * each record naming `machine`, this worker's id. None on the
	 * coordinator's machine, whose tasks are worktrees of the main tree.
	 */
	clones?: { checkouts: Checkouts; machine: string };
	/** The workers the coordinator reaches, which a clone elsewhere is read on. */
	machines?: WorkerMachines;
	/**
	 * The numbered records, shared with the list of tasks so both write under
	 * one lock; one of its own, locked in this process alone, by default.
	 */
	store?: TaskStore;
}
