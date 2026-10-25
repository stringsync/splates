import type { ServerChoice } from "@stringsync/splates-server/server";
import { useDisposerEffect } from "@webappwiz/react";
import { createContext, useContext, useState } from "react";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { EverywhereContext } from "./everywhere-context";
import type { EverywhereFeed } from "./everywhere-feed";
import { listProjects, type ProjectChoice } from "./project-api";

export type ProjectListEvents = { changed: undefined; refused: unknown };

/**
 * The projects the switcher offers, as `/api/projects` lists them, kept for
 * the page and read again whenever every project's feed moves what they
 * show: a project added or forgotten, or an agent coming to wait on you or
 * done waiting. So the switcher opens on a list already current, rather
 * than asking as it opens.
 */
export class ProjectList implements Eventful<ProjectListEvents> {
	private readonly dispatcher = new Dispatcher<ProjectListEvents>();
	readonly events = this.dispatcher.events;

	/** Null until first listed, so none is never said before it is known. */
	projects: ProjectChoice[] | null = null;
	servers: ServerChoice[] = [];

	/** What of the feed the last listing went by, to read again once it moves. */
	private seen: Shown = { projects: [], tasks: [], conversations: "" };
	private listing = false;
	/** Asked again while a listing was on its way, which may have missed it. */
	private again = false;

	constructor(
		private readonly everywhere: Pick<
			EverywhereFeed,
			"events" | "hold" | "projects" | "tasks" | "conversations"
		>,
		private readonly list: typeof listProjects = listProjects,
	) {}

	/** Lists now, and again each time the feed moves what the list shows, until disposed. */
	start(): Resource {
		const held = this.everywhere.hold();
		const unlisten = this.everywhere.events.on("changed", () => {
			if (moved(this.seen, this.shows())) {
				void this.refresh();
			}
		});
		void this.refresh();
		return {
			dispose: () => {
				unlisten();
				held.dispose();
			},
		};
	}

	/** Lists again, at most one listing on its way at a time. */
	async refresh(): Promise<void> {
		if (this.listing) {
			this.again = true;
			return;
		}
		this.listing = true;
		this.seen = this.shows();
		try {
			const listed = await this.list();
			this.projects = listed.projects;
			this.servers = listed.servers;
			this.dispatcher.dispatch("changed");
		} catch (error) {
			this.dispatcher.dispatch("refused", error);
		} finally {
			this.listing = false;
		}
		if (this.again) {
			this.again = false;
			await this.refresh();
		}
	}

	/**
	 * What of the feed the list depends on: which projects there are, their
	 * tasks, and each conversation's status, which say how many wait on you.
	 * A streamed message moves none of this.
	 */
	private shows(): Shown {
		const { projects, tasks, conversations } = this.everywhere;
		return {
			projects,
			tasks,
			conversations: conversations
				.map((each) => `${each.project}/${each.id}:${each.status}`)
				.join(),
		};
	}
}

/** What of every project's feed a listing went by. */
interface Shown {
	projects: readonly object[];
	tasks: readonly object[];
	conversations: string;
}

/**
 * Whether `now` differs from `before`, a project or task by identity: the
 * feed keeps an unchanged one's.
 */
function moved(before: Shown, now: Shown): boolean {
	const same = (one: readonly object[], other: readonly object[]) =>
		one.length === other.length && one.every((each, at) => each === other[at]);
	return (
		before.conversations !== now.conversations ||
		!same(before.projects, now.projects) ||
		!same(before.tasks, now.tasks)
	);
}

/**
 * The page's one list, which `ProjectApp` keeps past a switch of project;
 * none outside it, as in a test of `App` alone.
 */
export const ProjectListContext = createContext<ProjectList | null>(null);

/**
 * The page's list of projects, or, outside `ProjectApp`, one of the
 * component's own, kept current while it is mounted.
 */
export function useProjectList(): ProjectList {
	const kept = useContext(ProjectListContext);
	const everywhere = useContext(EverywhereContext);
	const [own] = useState(() =>
		kept === null ? new ProjectList(everywhere) : null,
	);
	useDisposerEffect(
		(disposer) => {
			if (own !== null) {
				disposer.use(own.start());
			}
		},
		[own],
	);
	return kept ?? (own as ProjectList);
}
