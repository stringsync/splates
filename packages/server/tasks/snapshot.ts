import { basename, resolve } from "node:path";
import type { Fs } from "core/system";
import type * as Board from "../board";
import type { CredRequest, Creds } from "../creds";
import { limited, READ_CONCURRENCY } from "../limited";
import { MergeLine } from "../merge";
import type { Slot } from "../ports";
import type { Behind, Release, Stuck } from "../server/shared";
import { capturePlanMedia } from "./plan-media";
import { type Details, TaskDetails } from "./show";
import type { WorktreeService } from "./worktree-service";

/**
 * Reads the whole repo the way the CLI's read commands do. Takes no lease, so
 * the page can sit open on a live tree without disturbing the agent in it.
 */
export async function snapshot({
	project,
	service,
	tasks: queue,
	creds,
	fs,
	details,
	home,
	release = null,
	behind = null,
	stuck = null,
	unbuilt = false,
	slot = null,
}: {
	project: string;
	service: WorktreeService;
	tasks: Board.Tasks;
	creds: Creds;
	fs: Fs;
	/**
	 * What reads each task, kept across reads to keep what git said of each
	 * until git moves; a fresh one, keeping nothing, by default.
	 */
	details?: TaskDetails;
	/** The home directory to show as `~`, when there is one. */
	home?: string;
	release?: Release | null;
	behind?: Behind | null;
	stuck?: Stuck | null;
	unbuilt?: boolean;
	slot?: Slot | null;
}): Promise<Snapshot> {
	const [read, board, requestedCreds] = await Promise.all([
		tasksOf({ service, fs, details }),
		queue.board(),
		creds.requests(),
	]);
	// The server runs every merge, so its line holds every batch gating now.
	const running = new Set(
		read.filter((task) => task.gate === "running").map((task) => task.task),
	);
	const mergeBatches = MergeLine.of(service.git.root)
		.groups()
		.filter((group) => group.every((task) => running.has(task)));
	const tasks = await Promise.all(
		read.map(async (task) => {
			const batch = mergeBatches.find((each) => each.includes(task.task));
			const plan =
				task.plan === null
					? null
					: await capturePlanMedia({
							service,
							queue,
							fs,
							task: task.task,
							worktree: task.worktree,
							plan: task.plan,
							conversations: [task.takenBy, task.handedTo, task.caller],
						});
			return {
				...task,
				plan,
				...(batch === undefined ? {} : { mergeBatch: batch }),
			};
		}),
	);
	return {
		project,
		repo: basename(service.git.root),
		path: tilde(service.git.root, home),
		root: service.git.root,
		worktreeRoot: resolve(service.config.worktreeRoot),
		taskStalenessMs: service.config.taskStalenessMs,
		todos: board.todos,
		boards: board.boards,
		lanes: board.lanes,
		laneNames: board.laneNames,
		tasks,
		mergeBatches,
		creds: requestedCreds,
		trunk: service.config.trunk,
		release,
		behind,
		stuck,
		unbuilt,
		slot,
	};
}

/**
 * Everything one page shows: `task list`, and `list` and `show` for each
 * task.
 */
export interface Snapshot {
	/** What `?project=` names the project by, which the registry gives it. */
	project: string;
	/** The repository's directory name, so a page among many says whose it is. */
	repo: string;
	/** Where the repository sits, with the home directory as `~`. */
	path: string;
	/** The main tree, absolute, which agents' file paths start from. */
	root: string;
	/** The directory that holds each task's worktree, absolute. */
	worktreeRoot: string;
	/** Past this age a queued task is offered for removal rather than recommended. */
	taskStalenessMs: number;
	todos: Board.TaskRecord[];
	/** Its tasks' blockers in other projects, and theirs it blocks; absent unread. */
	elsewhere?: Board.ElsewhereOnBoard;
	/** The project's boards, in order; the first is the default. Absent from older servers. */
	boards?: Board.BoardRecord[];
	/** Every lane, in board order, empty ones too, each on its board. */
	lanes: Board.LaneRecord[];
	/**
	 * The name of every lane there has been, those on the board first, to
	 * name a lane's orchestrator after it once the lane is done.
	 */
	laneNames: Board.LaneRecord[];
	tasks: Details[];
	/** The merge batches running now, each leader first; absent from older servers. */
	mergeBatches?: string[][];
	/** Every cred agents requested, open or not, the latest first; never a value. */
	creds: CredRequest[];
	/** The branch tasks land on, which the main tree has checked out. */
	trunk: string;
	/** A newer splates than the one serving, once `splates server` has seen one on npm. */
	release: Release | null;
	/** Commits to splates's own source since `splates server` started from it. */
	behind: Behind | null;
	/** Upstream server commits the local source checkout has not followed yet; absent from older servers. */
	stuck?: Stuck | null;
	/**
	 * Whether building the page failed as `splates server` started, so the page
	 * serving is the one built before, and may be out of date.
	 */
	unbuilt: boolean;
	/** The slot `splates server --slot` serves under, shown beside the project's name. */
	slot: Slot | null;
	/** Why the queue failed to check on its last sweep; null while healthy, absent from older servers. */
	queueError?: string | null;
}

/** `list` and `show` for each task, as {@link snapshot} reads them. */
export async function tasksOf({
	service,
	fs,
	details = new TaskDetails({ fs }),
}: {
	service: WorktreeService;
	fs: Fs;
	details?: TaskDetails;
}): Promise<Details[]> {
	return limited(await service.list(), READ_CONCURRENCY, (worktree) =>
		details.get(worktree),
	);
}

/** What a page shows of `snapshot`, as a string to compare with the last pushed. */
export function fingerprint({
	todos,
	boards,
	lanes,
	laneNames,
	tasks,
	mergeBatches,
	creds,
	release,
	behind,
	stuck,
	queueError,
}: Snapshot): string {
	// Leaves out the fields that move on their own: `age` ticks every
	// minute, and hashing it would push to every open page for nothing.
	return JSON.stringify([
		release,
		behind,
		stuck ?? null,
		queueError ?? null,
		todos,
		boards ?? [],
		lanes,
		laneNames,
		creds,
		mergeBatches ?? [],
		tasks.map((task) => [
			task.task,
			task.status,
			task.gate,
			task.mergeSince,
			task.mergePlace,
			task.mergeSteps,
			task.comingConflict,
			task.ahead,
			task.unmerged,
			task.added,
			task.removed,
			task.plan,
			task.planProblems,
			task.autoPick,
		]),
	]);
}

/** `root` with a leading `home` written as `~`, the way a shell prompt shows it. */
function tilde(root: string, home: string | undefined): string {
	if (!home) {
		return root;
	}
	if (root === home) {
		return "~";
	}
	return root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root;
}
