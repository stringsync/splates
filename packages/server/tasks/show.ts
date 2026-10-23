import { color, type Logger } from "webappwiz/log";
import { type Fs, NodeFs } from "webappwiz/system";
import { age } from "../age";
import type { AutoPicked } from "../auto-pick";
import { fail } from "../exit";
import { checkPlan, PLAN_FILE, Plans, ready, unfinished } from "../plans";
import type { FinishedPlan } from "./finished";
import { landingNotices } from "./landings";
import type { DiffSize, Gate, Worktree } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/**
 * One task in full: what `list` shows for it, plus the `SPLATES.md` its agent
 * left at the worktree root. Reading a tree this way takes no lease, so it
 * cannot knock the agent driving it off its own work.
 */
export async function show(
	{ service, fs, log }: { service: WorktreeService; fs: Fs; log: Logger },
	task: string,
	opts: ShowOptions = {},
): Promise<void> {
	const worktree = await service.find(task);
	if (worktree.gone) {
		// A finished task's tree is gone, but its record still says what it
		// did and where it landed, which a demo of it needs.
		const finished = await finishedNamed(service, task);
		if (finished === null) {
			fail(
				"not_found",
				`no task '${task}': run \`splates list\` to see what there is`,
				{ task },
			);
		}
		log.info(
			(opts.json ?? false)
				? JSON.stringify({ status: "finished", ...finished }, null, "\t")
				: finishedReport(finished),
		);
		return;
	}
	const details = await new TaskDetails({ fs }).get(worktree);

	if (opts.json ?? false) {
		log.info(JSON.stringify(details, null, "\t"));
		return;
	}
	log.info(report(details));
}

export interface Details {
	task: string;
	/** Files predicted to conflict at the last checked committed tips. */
	comingConflict?: string[];
	landed?: string[];
	status: string;
	branch: string;
	base: string;
	/** The `splates server` conversation whose agent added it, or null. */
	caller: string | null;
	/**
	 * The `splates server` conversation whose agent last took it, or its caller's
	 * for a subagent; null for an agent outside the page.
	 */
	takenBy: string | null;
	worktree: string;
	lease: "held" | "stale" | "none";
	/** Where its merge stands before landing: waiting its turn, or testing; null with none under way. */
	gate: Gate | null;
	/** When its merge under way was asked for; null with none under way. */
	mergeSince: string | null;
	/** Its merge's place in line for the premerge lock while it waits, 1 next; null otherwise. */
	mergePlace: number | null;
	ahead: number | null;
	/**
	 * Whether removing it would lose work: commits its base does not have, or
	 * changes not yet committed besides its SPLATES.md. A branch reset behind
	 * its base has none.
	 */
	unmerged: boolean;
	added: number | null;
	removed: number | null;
	age: string | null;
	/** When it was added, which `age` counts from. */
	createdAt: string | null;
	/**
	 * The last sign of an agent at work on it: a splates command writing its
	 * record, a commit on its branch, or an edit to its SPLATES.md or to a file
	 * not yet committed. Null when nothing says.
	 */
	activeAt: string | null;
	/** The merges it has tried; at `mergeAttemptLimit`, only `splates retry` lets it try again. */
	mergeAttempts: number;
	mergeAttemptLimit: number;
	/**
	 * Whether the plan leaves nothing unchecked under `## Blocked` or
	 * `## Next`, which `splates merge` requires.
	 */
	ready: boolean;
	plan: string | null;
	/** How the `SPLATES.md` departs from the shape the skill prescribes. */
	planProblems: string[];
	/**
	 * Whether `splates add --agent` handed it to an agent that `splates server` has
	 * yet to start a conversation with.
	 */
	dispatched: boolean;
	/**
	 * The conversation `splates server` started for the agent another conversation
	 * handed it to, which answers to that one, its caller, rather than to the
	 * user; null for any other task.
	 */
	handedTo: string | null;
	/** The last Auto pick that started it, as its record keeps it; null before any. */
	autoPick: AutoPicked | null;
}

export interface ShowOptions {
	/** Print the details as JSON instead of prose. */
	json?: boolean;
}

/** Configures how {@link TaskDetails} gathers a task's info. */
export interface TaskDetailsOptions {
	/** What the worktree is read through; the real filesystem by default. */
	fs?: Fs;
}

/**
 * Everything there is to say about one task, as `show` prints it and the
 * `splates server` page shows it. Keep one to read tasks many times, and call
 * {@link moved} whenever a branch or a worktree's files may have moved.
 */
export class TaskDetails {
	// Split out so `dev` renders the same fields `show` prints, rather than
	// assembling its own and drifting.
	//
	// What git says of a task costs several git calls, so it is kept until
	// `moved`; the rest, its record and its SPLATES.md, is read every time.
	private readonly fs: Fs;
	/** Each task's git facts, by {@link gitKey}, read since git last moved. */
	private readonly kept = new Map<string, Promise<GitFacts>>();
	/** Bumped by {@link moved}, so a read begun before it is not kept. */
	private generation = 0;
	/** As `generation`, for the worktrees {@link moved} named, by path. */
	private readonly generations = new Map<string, number>();

	constructor(opts: TaskDetailsOptions = {}) {
		this.fs = opts.fs ?? new NodeFs();
	}

	/**
	 * Forgets what git said of every task: a branch, its base, or a
	 * worktree's files may have moved.
	 */
	moved(worktree?: string): void {
		if (worktree === undefined) {
			this.generation++;
			this.kept.clear();
			return;
		}
		// Only the files of that worktree changed: the others' facts stand.
		this.generations.set(worktree, (this.generations.get(worktree) ?? 0) + 1);
		for (const key of this.kept.keys()) {
			if (keyPath(key) === worktree) {
				this.kept.delete(key);
			}
		}
	}

	async get(worktree: Worktree): Promise<Details> {
		const { state } = worktree;
		const plan = worktree.exists
			? await new Plans(this.fs).read(worktree.path)
			: null;
		const { stat, ahead, committedAt, uncommitted } = await this.git(worktree);
		return {
			task: worktree.task,
			comingConflict: (await worktree.comingConflict())?.files ?? [],
			landed: await landingNotices(worktree),
			status: worktree.status,
			branch: worktree.branch,
			base: worktree.base,
			caller: worktree.caller,
			takenBy: worktree.takenBy,
			worktree: worktree.path,
			lease: worktree.leaseStatus,
			gate: worktree.gate,
			mergeSince: worktree.mergeSince,
			mergePlace: worktree.mergePlace,
			ahead,
			unmerged:
				// Unknown counts as unmerged, so nothing is discarded unasked.
				(ahead === null ? worktree.hasBranch : ahead > 0) ||
				uncommitted.some((path) => path !== PLAN_FILE),
			added: stat?.added ?? null,
			removed: stat?.removed ?? null,
			age: state ? age(state.createdAt) : null,
			createdAt: state?.createdAt ?? null,
			activeAt: await this.activeAt(worktree, committedAt, uncommitted),
			mergeAttempts: worktree.mergeAttempts,
			mergeAttemptLimit: worktree.mergeAttemptLimit,
			ready: ready(unfinished(plan ?? "")),
			plan,
			planProblems:
				plan === null ? [] : checkPlan(plan, { task: worktree.task }),
			dispatched:
				state?.dispatch !== undefined &&
				state.dispatch.conversation === undefined,
			handedTo: handOff(worktree)?.conversation ?? null,
			autoPick: state?.autoPick ?? null,
		};
	}

	/** What git says of `worktree`: kept since git last moved, or read now. */
	private git(worktree: Worktree): Promise<GitFacts> {
		const key = gitKey(worktree);
		const kept = this.kept.get(key);
		if (kept !== undefined) {
			return kept;
		}
		const stamp = () =>
			`${this.generation}:${this.generations.get(worktree.path) ?? 0}`;
		const generation = stamp();
		const read = this.readGit(worktree);
		this.kept.set(key, read);
		// A failed read, or one git moved under, is read again next time.
		read.then(
			() => {
				if (stamp() !== generation) {
					this.forget(key, read);
				}
			},
			() => this.forget(key, read),
		);
		return read;
	}

	private forget(key: string, read: Promise<GitFacts>): void {
		if (this.kept.get(key) === read) {
			this.kept.delete(key);
		}
	}

	private async readGit(worktree: Worktree): Promise<GitFacts> {
		// A record whose worktree or branch is gone is still worth showing: the
		// status names what is wrong, and asking git about a branch that is not
		// there would only fill the fields with nulls.
		const stat = worktree.hasBranch ? await worktree.size() : null;
		const ahead = worktree.hasBranch ? await worktree.commitsAhead() : null;
		// With none of its own, the branch's latest commit is its base's.
		const committedAt =
			(ahead ?? 0) > 0
				? await worktree
						.committedAt()
						.then((at) => (at ? Date.parse(at) : null))
				: null;
		const uncommitted = worktree.exists
			? (await worktree.uncommitted().catch(() => [])).map(pathOf)
			: [];
		return {
			stat,
			ahead,
			committedAt,
			uncommitted,
		};
	}

	/**
	 * The latest of its record's last write, its own latest commit, and the
	 * edits to its SPLATES.md and uncommitted files, as `Details.activeAt`.
	 */
	private async activeAt(
		worktree: Worktree,
		committedAt: number | null,
		uncommitted: string[],
	): Promise<string | null> {
		const edited = worktree.exists
			? [PLAN_FILE, ...uncommitted].map((path) =>
					this.fs
						.stat(`${worktree.path}/${path}`)
						.then((stat) => stat.mtimeMs)
						.catch(() => null),
				)
			: [];
		const times = await Promise.all([
			worktree.state ? Date.parse(worktree.state.updatedAt) : null,
			committedAt,
			...edited,
		]);
		const known = times.filter(
			(at): at is number => at !== null && Number.isFinite(at),
		);
		return known.length === 0
			? null
			: new Date(Math.max(...known)).toISOString();
	}
}

/**
 * What git and the worktree's files say of a task, which only a move of its
 * branch, its base or those files changes.
 */
interface GitFacts {
	stat: DiffSize | null;
	ahead: number | null;
	/** When its own latest commit was made, in ms; null with none of its own. */
	committedAt: number | null;
	/** The paths it has uncommitted, relative to its worktree. */
	uncommitted: string[];
}

/** What a task's git facts are read from, so a task that changes any is read anew. */
function gitKey(worktree: Worktree): string {
	return JSON.stringify([
		worktree.git.root,
		worktree.path,
		worktree.branch,
		worktree.base,
		worktree.exists,
		worktree.hasBranch,
	]);
}

/** The worktree path a {@link gitKey} was made of. */
function keyPath(key: string): string {
	return (JSON.parse(key) as string[])[1] ?? "";
}

/**
 * The path a `git status --porcelain` line names, the new one for a rename.
 * One git quotes keeps its escapes, so it stats as missing and counts for
 * nothing. The first line may have lost its leading space to the trim git's
 * output gets, leaving one status column where there were two.
 */
function pathOf(line: string): string {
	const path =
		(line[2] === " " ? line.slice(3) : line.slice(2)).split(" -> ").at(-1) ??
		"";
	return path.startsWith('"') ? path.slice(1, -1) : path;
}

function report(details: Details): string {
	const lines = [
		`${color.bold(details.task)} ${details.status}`,
		`  branch:    ${details.branch}`,
		`  base:      ${details.base}`,
		`  worktree:  ${details.worktree}`,
		`  lease:     ${details.lease}`,
		`  ahead:     ${details.ahead === null ? "?" : details.ahead}  ${diff(details)}`,
		`  age:       ${details.age ?? "?"}`,
	];
	if (details.comingConflict && details.comingConflict.length > 0) {
		lines.push(
			color.yellow(
				`  coming conflict (committed tips): ${details.comingConflict.join(", ")}`,
			),
		);
	}
	for (const notice of details.landed ?? []) {
		lines.push(color.yellow(`  ${notice}`));
	}
	if (details.plan !== null) {
		lines.push("", color.bold(PLAN_FILE), details.plan.trimEnd());
		for (const problem of details.planProblems) {
			lines.push(color.yellow(`  ${problem}`));
		}
	} else if (details.status !== "orphaned") {
		lines.push(
			"",
			color.yellow(
				`no ${PLAN_FILE}: whoever picks this up starts from the diff`,
			),
		);
	}
	return lines.join("\n");
}

/** The newest finished task named `task`, with its plan, or null for none. */
async function finishedNamed(
	service: WorktreeService,
	task: string,
): Promise<FinishedPlan | null> {
	const newest = (await service.finished.list()).find(
		(each) => each.task === task,
	);
	return newest === undefined ? null : service.finished.read(newest.key);
}

function finishedReport(finished: FinishedPlan): string {
	const ended =
		finished.ended === "removed" && finished.reason !== null
			? `removed (${finished.reason})`
			: finished.ended;
	const lines = [
		`${color.bold(finished.task)} finished`,
		`  ended:        ${ended} ${finished.endedAt}`,
		`  base:         ${finished.base}`,
		`  commit:       ${finished.commit ?? "none"}`,
		`  conversation: ${finished.conversation ?? "none"}`,
		`  started:      ${finished.startedAt}`,
	];
	if (finished.plan.trim() !== "") {
		lines.push("", color.bold(PLAN_FILE), finished.plan.trimEnd());
	} else {
		lines.push("", color.yellow(`no ${PLAN_FILE} was kept`));
	}
	return lines.join("\n");
}

function diff(details: Details): string {
	if (details.added === null || details.removed === null) {
		return "?";
	}
	return `${color.green(`+${details.added}`)} ${color.red(`-${details.removed}`)}`;
}

/**
 * The two ends of a task one conversation handed to an agent, from before
 * agents stopped handing tasks out: the caller that handed it out, and the
 * conversation `splates server` started for the agent. Null for any other
 * task, which answers to the user alone.
 */
export function handOff(
	worktree: Worktree,
): { caller: string; conversation: string } | null {
	const caller = worktree.caller;
	const conversation = worktree.state?.dispatch?.conversation;
	return caller === null ||
		conversation === undefined ||
		caller === conversation
		? null
		: { caller, conversation };
}
