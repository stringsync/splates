import { basename, resolve } from "node:path";
import type { Fs } from "webappwiz/system";
import type { LaneRecord, TaskRecord, Tasks } from "../board";
import type { CredRequest, Creds } from "../creds";
import { limited, READ_CONCURRENCY } from "../limited";
import type { Slot } from "../ports";
import type { Behind, Release } from "../server/shared";
import { type Details, TaskDetails } from "./show";
import type { WorktreeService } from "./worktree-service";

/**
 * Everything one page shows: `task list`, and `list` and `show` for each
 * task.
 */
export interface Snapshot {
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
	todos: TaskRecord[];
	/** Every lane, in board order, empty ones too. */
	lanes: LaneRecord[];
	/**
	 * The name of every lane there has been, those on the board first, to
	 * name a lane's orchestrator after it once the lane is done.
	 */
	laneNames: LaneRecord[];
	tasks: Details[];
	/** Every cred agents requested, open or not, the latest first; never a value. */
	creds: CredRequest[];
	/** The branch tasks land on, which the main tree has checked out. */
	trunk: string;
	/** A newer splates than the one serving, once `splates server` has seen one on npm. */
	release: Release | null;
	/** Commits to splates's own source since `splates server` started from it. */
	behind: Behind | null;
	/**
	 * Whether building the page failed as `splates server` started, so the page
	 * serving is the one built before, and may be out of date.
	 */
	unbuilt: boolean;
	/** The slot `splates server --slot` serves under, shown beside the project's name. */
	slot: Slot | null;
}

/**
 * Reads the whole repo the way the CLI's read commands do. Takes no lease, so
 * the page can sit open on a live tree without disturbing the agent in it.
 */
export async function snapshot({
	service,
	tasks: queue,
	creds,
	fs,
	details,
	home,
	release = null,
	behind = null,
	unbuilt = false,
	slot = null,
}: {
	service: WorktreeService;
	tasks: Tasks;
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
	unbuilt?: boolean;
	slot?: Slot | null;
}): Promise<Snapshot> {
	const tasks = await tasksOf({ service, fs, details });
	return {
		repo: basename(service.git.root),
		path: tilde(service.git.root, home),
		root: service.git.root,
		worktreeRoot: resolve(service.config.worktreeRoot),
		taskStalenessMs: service.config.taskStalenessMs,
		todos: (await queue.all()).map((each) => each.state),
		lanes: await queue.lanes(),
		laneNames: await queue.laneNames(),
		tasks,
		creds: await creds.requests(),
		trunk: service.config.trunk,
		release,
		behind,
		unbuilt,
		slot,
	};
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

/**
 * A key that changes only when what the page shows does, to push a snapshot
 * to open pages only when it differs from the last one pushed.
 */
export function fingerprint({
	todos,
	lanes,
	laneNames,
	tasks,
	creds,
	release,
	behind,
}: Snapshot): string {
	// Leaves out the fields that move on their own: `age` ticks every
	// minute, and hashing it would push to every open page for nothing.
	return JSON.stringify([
		release,
		behind,
		todos,
		lanes,
		laneNames,
		creds,
		tasks.map((task) => [
			task.task,
			task.status,
			task.ahead,
			task.unmerged,
			task.added,
			task.removed,
			task.plan,
			task.planProblems,
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
