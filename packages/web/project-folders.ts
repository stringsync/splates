/**
 * Every project's agents as the sidebar and the phone's inbox group them,
 * one project at a time: those waiting on you, whatever their project, in
 * one Needs you, then the page's own project's pinned agents, then those at
 * work, then the rest, then each other project with agents, which the lists
 * show as one line that switches to it. Only the grouping: each list draws
 * its own rows.
 */

import type { LaneRecord } from "@stringsync/splates-server/board";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Needing } from "@stringsync/splates-server/plans";
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
 * The page's own folder is there even with no agents, to start one in.
 */
export function foldersOf(
	projects: readonly EverywhereSummary[],
	tasks: readonly InProject<Details>[],
	conversations: readonly InProject<ConversationState>[],
	here: Here,
): Folders {
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
	const folders = listed
		.filter((each) => each.here || each.trees.length > 0)
		.sort(
			(one, other) =>
				one.name.localeCompare(other.name) ||
				(one.project ?? "").localeCompare(other.project ?? ""),
		);
	const ownFolder = folders.find((each) => each.here);
	if (ownFolder === undefined) {
		throw new Error("no folder for the page's own project");
	}
	return {
		needsYou: folders.flatMap((each) =>
			each.waiting.map((tree) => ({ folder: each, tree })),
		),
		here: ownFolder,
		others: folders.filter((each) => !each.here),
	};
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
	 * Its conversations with a subagent at work under them, as `hostsAtWork`
	 * reads every row, those the list leaves out too.
	 */
	hosting: Set<string>;
	/** The trees with an agent waiting on you, which Needs you lists in its place. */
	waiting: Nested<Needing>[];
	/**
	 * The other trees with none waiting, as the folder lists them: the pinned
	 * ones, then those with an agent at work, then the rest, each newest first.
	 */
	listed: Nested<Needing>[];
	/** How many of its trees have an agent at work. */
	atWork: number;
}

/** A tree in Needs you, with the folder it comes from. */
export interface Placed {
	folder: Folder;
	tree: Nested<Needing>;
}

export interface Folders {
	/** Every folder's waiting trees, folder by folder. */
	needsYou: Placed[];
	/** The project the page shows. */
	here: Folder;
	/** By name, the other projects with visible conversations. */
	others: Folder[];
}

/** The page's own project, as its snapshot and conversation feed have it. */
export interface Here {
	root: string;
	repo: string;
	trunk: string | null;
	tasks: Details[];
	conversations: ConversationState[];
}

/** The page's own project in a folder of its own, for a page without the feed. */
export function hereAlone(here: Here): Folders {
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
	{ repo, trunk, tasks, conversations }: Here,
	laneNames: readonly LaneRecord[] | null,
	lanesTaken: Readonly<Record<string, number>> | null,
	here: boolean,
): Folder {
	const trees = nestRows(tasks, rowsOf(tasks, conversations));
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
		listed: shown([...pinned, ...working, ...recent]),
		atWork: shownIn(trees).filter(atWork).length,
	};
}
