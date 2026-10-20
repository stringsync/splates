/**
 * Every project's agents as the sidebar and the phone's inbox group them:
 * a folder per project, its persistent agents kept apart atop it, then its
 * pinned agents, then those at work, then the rest. The inbox lifts those
 * waiting on you out into one Needs you across every project; the sidebar
 * leaves them in place. Only the grouping: each list draws its own rows.
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

/** Where the sidebar keeps its folders folded away, by `folderKey`. */
export const FOLDED_FOLDERS = "splates.sidebar.collapsed";

/**
 * Every project's agents in folders, the page's own from `here`, which
 * shows a change at once, and the rest from the feed of every project.
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
	return {
		needsYou: folders.flatMap((each) =>
			each.waiting.map((tree) => ({ folder: each, tree })),
		),
		folders,
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
	 * Its persistent agents' trees with none waiting, as the groomer's: kept
	 * atop the folder, apart from the agents it lists.
	 */
	kept: Nested<Needing>[];
	/**
	 * The other trees with none waiting, as the folder lists them: the pinned
	 * ones, then those with an agent at work, then the rest, each newest first.
	 */
	listed: Nested<Needing>[];
	/**
	 * Its trees as the sidebar lists them, those waiting on you left in
	 * place, among the agents at work, so a row never jumps as its agent
	 * stops to ask.
	 */
	inPlace: { kept: Nested<Needing>[]; listed: Nested<Needing>[] };
}

/** A tree in Needs you, with the folder it comes from. */
export interface Placed {
	folder: Folder;
	tree: Nested<Needing>;
}

export interface Folders {
	/** Every folder's waiting trees, folder by folder. */
	needsYou: Placed[];
	/**
	 * By name, each project with an agent listed, and the page's own
	 * whatever it has.
	 */
	folders: Folder[];
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

/** What a folder's fold is kept under. */
export function folderKey(folder: Folder): string {
	return folder.project ?? "";
}

/**
 * `trees` by what is most pressing in each: one waiting on you, then the
 * rest a persistent agent's, pinned, at work, or none of those, each in the
 * order given. Not `apart`, none is waiting: one that waits on you goes
 * where it would otherwise, among those at work when no other holds it.
 */
export function groupsOf(
	trees: Nested<Needing>[],
	apart = true,
): Record<
	"waiting" | "kept" | "pinned" | "working" | "recent",
	Nested<Needing>[]
> {
	const waits = (tree: Nested<Needing>) =>
		flatten([tree]).some((row) => waitsOnYou(row));
	const waiting = apart ? trees.filter(waits) : [];
	const rest = trees.filter((tree) => !waiting.includes(tree));
	const kept = rest.filter(
		(tree) => tree.row.conversation?.persistent !== undefined,
	);
	const pinned = rest.filter(
		(tree) => !kept.includes(tree) && tree.row.conversation?.pinned === true,
	);
	const working = rest.filter(
		(tree) =>
			!kept.includes(tree) &&
			!pinned.includes(tree) &&
			(waits(tree) ||
				flatten([tree]).some(
					(row) => row.need.kind === "working" || row.need.kind === "assuming",
				)),
	);
	const recent = rest.filter(
		(tree) =>
			!kept.includes(tree) && !pinned.includes(tree) && !working.includes(tree),
	);
	return { waiting, kept, pinned, working, recent };
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
	const { waiting, kept, pinned, working, recent } = groupsOf(trees);
	const shown = (of: Nested<Needing>[]) => shownIn(of);
	const steady = groupsOf(trees, false);
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
		kept: shown(kept),
		listed: shown([...pinned, ...working, ...recent]),
		inPlace: {
			kept: shown(steady.kept),
			listed: shown([...steady.pinned, ...steady.working, ...steady.recent]),
		},
	};
}
