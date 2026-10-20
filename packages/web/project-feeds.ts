import type { EverywhereProject } from "@stringsync/splates-server/projects";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import type { Duration, Timer, WallClock } from "webappwiz/time";
import { ConversationFeed } from "./conversation-feed";
import type { EverywhereFeed } from "./everywhere-feed";
import { Feed } from "./feed";
import { KeptPage } from "./kept-page";
import { IndexedPageCopies, type PageCopies } from "./page-copies";

/** A project's feeds. */
export interface Feeds {
	feed: Feed;
	talk: ConversationFeed;
}

/**
 * Each project's feeds, for as long as the page: kept past a switch to
 * another project, to show what they last held on a return while they read
 * it again, and a project not shown before starts from what the page holds
 * of it already, so a switch draws at once.
 */
export class ProjectFeeds {
	/** By slug, and "" for the focused one. */
	private readonly kept = new Map<string, Feeds>();
	/** The project `of` last gave the feeds of. */
	private shown: string | null = null;
	/** Where each project's feeds keep what they last drew, if anywhere. */
	private readonly copies: PageCopies | null;

	constructor(
		private readonly everywhere: EverywhereFeed,
		private readonly opts: ProjectFeedsOptions = {},
	) {
		this.copies =
			opts.copies !== undefined
				? opts.copies
				: typeof indexedDB === "undefined"
					? null
					: new IndexedPageCopies(indexedDB);
	}

	/** The feeds of `project`, a slug or "" for the focused one, as the page shows it. */
	of(project: string): Feeds {
		let feeds = this.kept.get(project);
		// Picking a project focuses it, so the focused one's feeds are some
		// other project's by the time the address names none again.
		if (feeds === undefined || (project === "" && this.shown !== "")) {
			const kept = KeptPage.open(project, this.copies, this.opts.timer);
			feeds = {
				feed: new Feed({
					offlineAfter: this.opts.offlineAfter,
					copy: kept?.snapshot,
					project,
				}),
				talk: new ConversationFeed(this.opts.timer, this.opts.wall, undefined, {
					copy: kept?.listing,
					project,
				}),
			};
			this.seed(feeds, project);
			this.kept.set(project, feeds);
		}
		this.shown = project;
		return feeds;
	}

	/**
	 * Starts `project`'s feeds from what the page holds of it: all of it when
	 * it was last shown as the focused one, else what every project's feed
	 * holds of it, with what another project's says of the server they share.
	 */
	private seed({ feed, talk }: Feeds, project: string): void {
		// The focused project goes by no slug the feed knows it by.
		const listed = project === "" ? undefined : this.everywhere.listed(project);
		if (listed === undefined) {
			return;
		}
		const focused = this.kept.get("")?.feed.snapshot;
		if (focused != null && focused.root === listed.root) {
			feed.seed(focused, { whole: true });
		} else {
			const served = [...this.kept.values()].find(
				(each) => each.feed.snapshot !== null && !each.feed.seeded,
			)?.feed.snapshot;
			feed.seed(snapshotOf(listed, served));
		}
		talk.seed(listed.conversations);
	}
}

/** What each project's feeds wait and read the date by, and keep copies in. */
export interface ProjectFeedsOptions {
	/** Where the page keeps what it last drew; IndexedDB by default, where there is one. */
	copies?: PageCopies | null;
	/** How long the server stays unreachable before the page says so. */
	offlineAfter?: Duration;
	timer?: Timer;
	wall?: WallClock;
}

/**
 * A stand-in for `listed`'s snapshot, from what every project's feed holds
 * of it: its tasks whole, none of its todos, lanes or creds, and what
 * `served`, another project's, says of the server.
 */
function snapshotOf(
	listed: EverywhereProject,
	served: Snapshot | null | undefined,
): Snapshot {
	return {
		repo: listed.repo,
		path: listed.root,
		root: listed.root,
		worktreeRoot: listed.worktreeRoot,
		taskStalenessMs: 0,
		todos: [],
		lanes: [],
		laneNames: listed.laneNames,
		tasks: listed.tasks,
		creds: [],
		trunk: listed.trunk,
		release: served?.release ?? null,
		behind: served?.behind ?? null,
		unbuilt: served?.unbuilt ?? false,
		slot: served?.slot ?? null,
	};
}
