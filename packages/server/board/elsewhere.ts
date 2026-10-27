import type { TaskRecord, TaskStage } from "./task";

/**
 * Where tasks' blockers in other projects stand, read from `boards`: `of`
 * for one task, as `task show` says it, `onBoard` for a page's whole board.
 */
export class ElsewhereStanding {
	constructor(private readonly boards: ElsewhereBoards) {}

	/**
	 * `task`'s blockers in other projects, each as it stands now: those
	 * settled as its record says, the rest as that project's board does.
	 */
	of(task: TaskRecord): Promise<ElsewhereBlockerNow[]> {
		return Promise.all(
			(task.blockedElsewhere ?? []).map(
				async (blocker): Promise<ElsewhereBlockerNow> => {
					const slug = await this.boards.slug(blocker.project);
					if (blocker.landed !== undefined) {
						return { ...blocker, slug, status: "merged" };
					}
					if (blocker.lost) {
						return { ...blocker, slug, status: "removed" };
					}
					const found = await this.boards
						.find(blocker.project, blocker.id)
						.catch(() => null);
					return { ...blocker, slug, status: found?.status ?? "unknown" };
				},
			),
		);
	}

	/**
	 * The blockers in other projects of the tasks among `todos`, as `of`
	 * reads them, and the tasks of other projects that wait on each, for the
	 * board of the project at `root`.
	 */
	async onBoard(
		todos: readonly TaskRecord[],
		root: string,
	): Promise<ElsewhereOnBoard> {
		const blockers: ElsewhereOnBoard["blockers"] = {};
		for (const todo of todos) {
			if ((todo.blockedElsewhere ?? []).length > 0) {
				blockers[todo.id] = await this.of(todo);
			}
		}
		const following: ElsewhereOnBoard["following"] = {};
		for (const follower of await this.boards.following(root).catch(() => [])) {
			following[follower.blocker] = [
				...(following[follower.blocker] ?? []),
				follower,
			];
		}
		return { blockers, following };
	}
}

/** Whether `blocker` still holds its task back: open there, or gone without merging. */
export function holding(blocker: ElsewhereBlocker): boolean {
	return blocker.landed === undefined;
}

/** The same blocker: one project's task by its number. */
export function sameBlocker(
	one: Pick<ElsewhereBlocker, "project" | "id">,
	other: Pick<ElsewhereBlocker, "project" | "id">,
): boolean {
	return one.project === other.project && one.id === other.id;
}

/** How a blocker in another project is written: `webappwiz #404`. */
export function elsewhereName(
	blocker: Pick<ElsewhereBlocker, "project" | "id"> & { slug?: string },
): string {
	// The page has no `node:path`: a root's last part is its name.
	const name =
		blocker.slug ?? blocker.project.split("/").filter(Boolean).at(-1);
	return `${name ?? blocker.project} #${blocker.id}`;
}

/**
 * `blocker` as `found` says it ended: landed once it merged, lost once
 * removed, or as it was while still open or unread.
 */
export function settled(
	blocker: ElsewhereBlocker,
	found: ElsewhereTask | null,
): ElsewhereBlocker {
	if (!holding(blocker) || blocker.lost || found === null) {
		return blocker;
	}
	if (found.status === "merged") {
		return { ...blocker, landed: found.commit };
	}
	if (found.status === "removed") {
		return { ...blocker, lost: true };
	}
	return blocker;
}

/** What `ElsewhereStanding.onBoard` reads, by task number. */
export interface ElsewhereOnBoard {
	/** Each task's blockers in other projects, as they stand now. */
	blockers: Record<number, ElsewhereBlockerNow[]>;
	/** The tasks of other projects that wait on each task. */
	following: Record<number, ElsewhereFollower[]>;
}

/** A line for each of `blockers`, as `task show` and `queue list` say them. */
export function elsewhereLine(blocker: ElsewhereBlockerNow): string {
	const said =
		blocker.status === "merged"
			? `merged as ${blocker.landed}`
			: blocker.status === "removed"
				? "removed without merging: unlink it once you decide this task still makes sense"
				: blocker.status === "unknown"
					? "its project cannot be read"
					: blocker.status;
	return `${elsewhereName(blocker)} ${blocker.subject} (${said})`;
}

/**
 * A task of another splates project, `webappwiz #404`, that has to merge
 * before the task it is kept on starts. Link one with
 * `ElsewhereLinks.link`; the queue holds the task until `landed` is set.
 */
export interface ElsewhereBlocker {
	/** That project's main tree. */
	project: string;
	/** Its number there. */
	id: number;
	/** Its subject when linked, for when it is gone. */
	subject: string;
	/** The commit it landed as there, once it merged. */
	landed?: string;
	/**
	 * Set once it left that board without merging: whether this task still
	 * makes sense is the person's call, made by unlinking it.
	 */
	lost?: true;
}

/**
 * Where a task of another project stands: the stage it waits in, `working`
 * once an agent took it, `merged` with the commit it landed as, `removed`
 * once gone without merging.
 */
export type ElsewhereTask =
	| {
			status: Exclude<TaskStage, "running"> | "working";
			subject: string;
			lane: number | null;
			takenBy: string | null;
	  }
	| { status: "merged"; commit: string }
	| { status: "removed" };

/** What one task's blocker in another project is now, as the page and CLI say it. */
export interface ElsewhereBlockerNow extends ElsewhereBlocker {
	/** That project's slug, which `--project` and `?project=` take. */
	slug: string;
	/** Where it stands; `unknown` while that project cannot be read. */
	status: ElsewhereTask["status"] | "unknown";
}

/** A task of another project that waits on one of this project's, `blocker`. */
export interface ElsewhereFollower {
	/** The number here of the task it waits on. */
	blocker: number;
	/** That project's main tree. */
	project: string;
	slug: string;
	id: number;
	subject: string;
	stage: TaskStage;
}

/** Reads the boards of the other splates projects on this machine. */
export interface ElsewhereBoards {
	/** The registered project `slug` names, or null for none. */
	root(slug: string): Promise<string | null>;
	/** What the registry names the project at `root` by. */
	slug(root: string): Promise<string>;
	/** Task `id` of the project at `root` now, or null when it cannot be read. */
	find(root: string, id: number): Promise<ElsewhereTask | null>;
	/** The open tasks of every other project blocked by a task of `root`'s. */
	following(root: string): Promise<ElsewhereFollower[]>;
	/** The open tasks of every project but the one at `root`, to pick a blocker from. */
	openTasks(root: string): Promise<ElsewhereOpen[]>;
}

/** An open task of another project, which a task here may wait on. */
export interface ElsewhereOpen {
	/** That project's main tree. */
	project: string;
	/** Its slug. */
	slug: string;
	id: number;
	subject: string;
	lane: number | null;
}
