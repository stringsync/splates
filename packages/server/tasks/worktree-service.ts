// scry-ignore-file compact-files: one service over a task's record, tree and checkout, which adding, discarding and amending its record share
import { relative, resolve, sep } from "node:path";
import { type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";
import { Attachments } from "../artifacts";
import { TaskStore } from "../board";
import type { Config } from "../config";
import type { Entry } from "../conversations";
import type { Git, GitResult } from "../git";
import { limited, READ_CONCURRENCY } from "../limited";
import { ranWith } from "../models";
import { decisions, goalLine, outcomeOf, Plans, picks } from "../plans";
import { runnerShares, type Spend } from "../spend";
import type { Adherence } from "../stats";
import { findings, type Outcomes, promptsFrom, taskLog } from "../stats";
import { type Collection, FsStorage, type Log, type Storage } from "../storage";
import { Finished } from "./finished";
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
	/** The project's records. */
	readonly storage: Storage;
	private readonly records: StartedRecords;
	private readonly removed: Collection;
	private readonly conversationsDir: string;
	private readonly plans: Collection;
	/** Every task that merged or was removed here, newest kept, to look back on. */
	readonly finished: Finished;
	private readonly fs: Fs;
	private readonly outcomes: Outcomes | null;
	private readonly adherence: Adherence | null;
	private readonly spend: Spend | null;
	private readonly worktrees: WorktreeCheckouts;
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
		this.storage =
			opts.store?.storage ?? opts.storage ?? new FsStorage(splatesDir, this.fs);
		this.outcomes = opts.outcomes ?? null;
		this.adherence = opts.adherence ?? null;
		this.spend = opts.spend ?? null;
		this.worktrees = new WorktreeCheckouts(git, this.fs);
		this.records = new StartedRecords(
			opts.store ?? new TaskStore(this.storage),
		);
		this.removed = this.storage.collection("removed");
		this.conversationsDir = this.storage.locate("conversations");
		this.plans = this.storage.collection("plans");
		this.finished = new Finished(
			this.storage,
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

	/**
	 * The persistent agent's role of the conversation `conversation()` names,
	 * as `"groomer"`, read from its log's first entry, which says what it
	 * was started for; undefined for an ordinary one, or none.
	 */
	async callerRole(): Promise<string | undefined> {
		const id = await this.conversation();
		if (id === undefined) {
			return undefined;
		}
		const [start] = await this.conversationLog(id).replay();
		return start?.kind === "start" ? start.persistent : undefined;
	}

	/** The log of the conversation `id`. */
	conversationLog(id: string): Log<Entry> {
		return this.storage.log(`conversations/${id}.jsonl`);
	}

	/**
	 * Where the log of conversation `id` sits on this machine, which its
	 * artifacts, not on storage yet, are kept beside.
	 */
	conversationPath(id: string): string {
		return `${this.conversationsDir}/${id}.jsonl`;
	}

	/** Whether the `splates server` conversation `id` is one of this repo's. */
	holds(id: string): Promise<boolean> {
		return this.conversationLog(id).exists();
	}

	async init(): Promise<void> {
		await this.storage.collection("tasks").ensure();
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
			this.storage,
			`conversations/${conversation}/attached/${task}`,
		);
	}

	/**
	 * Every folder holding files `task` attached: its own, and one in each
	 * conversation that attached some.
	 */
	async filesOf(task: string): Promise<Attachments[]> {
		const own = await this.files(task);
		const folders = own === null ? [] : [own];
		for (const entry of await this.storage.children("conversations")) {
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
		return this.storage.size(`conversations/${conversation}`);
	}

	/**
	 * Whether `path` is a file some task or conversation holds for a task:
	 * one level inside a started task's folder, or inside a conversation's
	 * `attached/<task>/`, never a record or log, and not a way out of here.
	 */
	owns(path: string): boolean {
		const parts = relative(this.storage.locate("tasks"), resolve(path)).split(
			sep,
		);
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
		const exists = await this.fs.exists(path);
		const hasBranch = await this.git.branchExists(branch);
		return new Worktree(this, {
			task,
			branch,
			path,
			state,
			exists,
			hasBranch,
			corrupt,
			git: this.git,
			// Only worth asking when there is nothing else left of the task.
			removedAt:
				state || exists || hasBranch || corrupt
					? null
					: await this.removedAt(task),
		});
	}

	/** Changes task `task`'s started record as `StartedRecords.amend` does. */
	amend(
		task: string,
		change: (state: TaskState) => TaskState | null,
	): Promise<void> {
		return this.records.amend(task, change);
	}

	/** Every started task's record, as it stands. */
	states(): Promise<TaskState[]> {
		return this.records.all();
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
		return this.worktrees.add(
			task,
			this.branchFor(task),
			this.pathFor(task),
			base,
		);
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
		const removed = await this.worktrees.remove(worktree.path, worktree.branch);
		if (removed.code !== 0) {
			return removed;
		}
		if (record !== null && worktree.state) {
			await this.finished.record(
				{
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
				},
				// Copied before the task's own folder goes with its record.
				(path) => this.owns(path),
			);
		}
		await this.records.end(worktree.task, { unqueue: opts.unqueue });
		await this.storage.document(`conflicts/${worktree.task}.json`).remove();
		await this.rememberRemoved(worktree.task);
		await this.recordOutcome(worktree, ended, ending, opts);
		return removed;
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
			(await this.plans.read(`${worktree.task}.md`).catch(() => "")) ??
			""
		);
	}

	private async recordOutcome(
		{ task, base, state }: Worktree,
		ended: "merged" | "removed",
		ending: Ending,
		opts: DiscardOptions,
	): Promise<void> {
		const { outcomes } = this;
		if (!outcomes || !state) {
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
			conversation === null ? null : this.conversationLog(conversation);
		const ran = log === null ? null : await ranWith(log);
		const worked =
			log === null
				? null
				: await taskLog(log, state.createdAt, endedAt, {
						catalog: () => outcomes.prices.catalog(),
					});
		const judged =
			conversation === null || this.adherence === null
				? null
				: ((await this.adherence.list()).find(
						(each) => each.conversation === conversation,
					) ?? null);
		const workerSpend =
			this.spend === null
				? null
				: (runnerShares(
						await this.spend.lines(),
						Date.now(),
						[],
						Date.parse(state.createdAt),
						Date.parse(endedAt),
					).find(
						(share) => share.project === this.git.root && share.task === task,
					) ?? null);
		await outcomes.record({
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
			...(state.autoPick === undefined || !worked?.overrides.length
				? {}
				: {
						overrides: worked.overrides.map((each) => ({
							aspect: each.aspect,
							to: each.value,
							at: each.at,
							rule: state.autoPick?.rule ?? 0,
							kind: state.autoPick?.kind ?? null,
							depth: state.autoPick?.depth ?? null,
						})),
					}),
			...(outcomeOf(ending.plan) === ""
				? {}
				: { outcome: outcomeOf(ending.plan) }),
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
				log === null ? {} : await promptsFrom(log, state.createdAt, endedAt),
			...(worked === null
				? {}
				: {
						usage: worked.usage,
						workedMs: worked.workedMs,
						turns: worked.turns,
					}),
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
			...(opts.merge === undefined ? {} : { merge: opts.merge }),
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

	private async removedAt(task: string): Promise<string | null> {
		const raw = await this.removed.read(task).catch(() => null);
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
		await this.removed.write(task, `${at}\n`);
		const names = await this.removed.list();
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
			await this.removed.remove(name);
		}
	}
}

/** What `discard` reads off a task for its outcome before the tree goes. */
interface Ending {
	plan: string;
	/** What it landed or would have; null when there is no branch to read. */
	size: DiffSize | null;
}

/** What a `WorktreeService` works through; the real ones by default. */
export interface WorktreeServiceOptions {
	fs?: Fs;
	/** The project's storage, unless `store` brings it; the files under `splatesDir`, on `fs`, by default. */
	storage?: Storage;
	ps?: Ps;
	/** Where each task's ending is written down; none, and nothing is. */
	outcomes?: Outcomes;
	/** How closely conversations follow the skill, which an ending's findings read. */
	adherence?: Adherence;
	/** The spend ledger, which an ending reads what runners cost it from. */
	spend?: Spend;
	/**
	 * The numbered records, shared with the list of tasks so both write under
	 * one lock; one of its own, locked in this process alone, by default.
	 */
	store?: TaskStore;
}
