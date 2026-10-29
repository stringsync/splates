/**
 * Every project's agents as the sidebar and the phone's inbox group them: a
 * folder per project by name, those with no agents too, but General first
 * and only while it has some,
 * each with its agents waiting on you on top, then its pinned ones,
 * then those at work, then the rest. What waits on you stays in its own
 * project, so reading down one never jumps to another's, and a switch moves
 * no folder. Only the grouping:
 * each list draws its own rows.
 */

import type { LaneRecord, TaskRecord } from "@stringsync/splates-server/board";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Needing } from "@stringsync/splates-server/plans";
import { GENERAL } from "@stringsync/splates-server/projects/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	flatten,
	hostsAtWork,
	nestRows,
	rowsOf,
	shownIn,
	waitsOnYou,
} from "./conversation-rows";
import type { EverywhereSummary, InProject } from "./everywhere-feed";
import type { Nested } from "./parts";

/**
 * Every project's agents in folders, the page's own from `here`, which
 * shows a change at once, and the rest from the feed of every project.
 * Every project has its folder, even with no agents, so none comes and
 * goes under you; only General, no project, shows once it has agents, or
 * while the page shows it.
 */
export function foldersOf(
	projects: readonly EverywhereSummary[],
	tasks: readonly InProject<Details>[],
	conversations: readonly InProject<ConversationState>[],
	here: Here,
): Folder[] {
	const listed = projects.map((project) =>
		project.root === here.root
			? folder(project.project, here, null, null, true)
			: folder(
					project.project,
					{
						root: project.root,
						repo: project.repo,
						trunk: project.trunk,
						tasks: tasks.filter((each) => each.project === project.project),
						conversations: conversations.filter(
							(each) => each.project === project.project,
						),
					},
					project.laneNames,
					project.lanesTaken,
					false,
				),
	);
	if (!listed.some((each) => each.here)) {
		listed.push(folder(null, here, null, null, true));
	}
	return listed
		.filter(
			(each) =>
				each.project !== GENERAL ||
				each.here ||
				each.conversations.some((conversation) => !conversation.archived),
		)
		.sort((one, other) =>
			one.project === GENERAL
				? -1
				: other.project === GENERAL
					? 1
					: one.name.localeCompare(other.name) ||
						(one.project ?? "").localeCompare(other.project ?? ""),
		);
}

/** One project's agents. */
export interface Folder {
	/** Its slug, as `?project=` names it; null for the page's own, unlisted yet. */
	project: string | null;
	/** Its repository's name, as its page heads itself. */
	name: string;
	/** Whether it is the project the page shows, whose rows open in place. */
	here: boolean;
	trunk: string | null;
	/** Its lanes, to name an orchestrator after; null for the page's own, whose snapshot has them. */
	laneNames: readonly LaneRecord[] | null;
	/**
	 * The lane each of its tasks at work on a lane is on, by task name; null
	 * for the page's own, whose snapshot has its queued tasks.
	 */
	lanesTaken: Readonly<Record<string, number>> | null;
	tasks: Details[];
	conversations: ConversationState[];
	/** Each with the agents it handed out, those waiting on you among them. */
	trees: Nested<Needing>[];
	/**
	 * The ids of its conversations with a subagent at work under them, even
	 * one the list leaves out, to show those hosts as at work.
	 */
	hosting: Set<string>;
	/** The trees with an agent waiting on you, which its header counts. */
	waiting: Nested<Needing>[];
	/**
	 * Its trees as the folder lists them: those waiting on you, then the
	 * pinned ones, then those with an agent at work, then the rest, each
	 * newest first.
	 */
	listed: Nested<Needing>[];
	/** How many of its trees have an agent at work. */
	atWork: number;
}

/** The page's own project, as its snapshot and conversation feed have it. */
export interface Here {
	root: string;
	repo: string;
	trunk: string | null;
	tasks: Details[];
	conversations: ConversationState[];
	/** The board's tasks where known; other projects' summaries do not hold them. */
	todos?: readonly TaskRecord[];
}

/** The page's own project in a folder of its own, for a page without the feed. */
export function hereAlone(here: Here): Folder[] {
	return foldersOf([], [], [], here);
}

/** What tells a folder apart from the others. */
export function folderKey(folder: Folder): string {
	return folder.project ?? "";
}

/**
 * `trees` by what is most pressing in each: one waiting on you, then the
 * rest pinned, at work, or none of those, each in the order given.
 */
export function groupsOf(
	trees: Nested<Needing>[],
): Record<"waiting" | "pinned" | "working" | "recent", Nested<Needing>[]> {
	const waiting = trees.filter((tree) =>
		flatten([tree]).some((row) => waitsOnYou(row)),
	);
	const rest = trees.filter((tree) => !waiting.includes(tree));
	const pinned = rest.filter((tree) => tree.row.conversation?.pinned === true);
	const working = rest.filter((tree) => !pinned.includes(tree) && atWork(tree));
	const recent = rest.filter(
		(tree) => !pinned.includes(tree) && !working.includes(tree),
	);
	return { waiting, pinned, working, recent };
}

/** Whether an agent of `tree` is at work. */
function atWork(tree: Nested<Needing>): boolean {
	return flatten([tree]).some(
		(row) => row.need.kind === "working" || row.need.kind === "assuming",
	);
}

function folder(
	project: string | null,
	{ repo, trunk, tasks, conversations, todos }: Here,
	laneNames: readonly LaneRecord[] | null,
	lanesTaken: Readonly<Record<string, number>> | null,
	here: boolean,
): Folder {
	const trees = nestRows(tasks, rowsOf(tasks, conversations, todos));
	// Grouped with every row, so a subagent at work outside the page still
	// puts its host with those at work, then only what the list shows.
	const { waiting, pinned, working, recent } = groupsOf(trees);
	const shown = (of: Nested<Needing>[]) => shownIn(of);
	return {
		project,
		name: repo,
		here,
		trunk,
		laneNames,
		lanesTaken,
		tasks,
		conversations,
		trees: shown(trees),
		hosting: hostsAtWork(trees),
		waiting: shown(waiting),
		listed: shown([...waiting, ...pinned, ...working, ...recent]),
		atWork: shownIn(trees).filter(atWork).length,
	};
}

/** Where this browser keeps which projects the sidebar and the inbox fold away. */
export const FOLDED_FOLDERS = "splates.sidebar.collapsed";
