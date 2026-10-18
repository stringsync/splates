import type { AsyncResource, Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { LaneRecord } from "../board";
import { type ConversationState, listed } from "../conversations";
import type { Served } from "../server/shared";
import {
	type EventSink,
	eventStream,
	type StreamWatcher,
} from "../server/shared";
import type { Details } from "../tasks";
import type { Projects } from "./projects";

/**
 * What `GET /api/everywhere` answers: every project served so far, its
 * slug first among what it holds, so a page shows all of them at once.
 */
export interface EverywhereListing {
	/** By slug, alphabetically. */
	projects: EverywhereProject[];
}

/** One project as the every-project feed carries it. */
export interface EverywhereProject extends EverywhereBoard {
	/**
	 * Newest first, as its own page lists them, the archived ones as
	 * summaries; none while they are off.
	 */
	conversations: ConversationState[];
}

/**
 * What of one project's snapshot the every-project feed carries, sent whole
 * as `event: board` whenever any of it moves.
 */
export interface EverywhereBoard {
	/** What `?project=` names it by. */
	project: string;
	/** Its repository's directory name. */
	repo: string;
	/** Its main tree. */
	root: string;
	trunk: string;
	tasks: Details[];
	/** Every lane there has been, to name an orchestrator after. */
	laneNames: LaneRecord[];
}

/**
 * Every registered project's tasks and conversations, on one stream: what
 * a page listing them across projects reads. The first ask opens each
 * project not yet served, one at a time behind the focused one, so `owned`
 * finds any conversation and the focused page never waits on the rest.
 *
 * The stream says:
 * - a conversation, whole, as `data: {project, conversation}`;
 * - `event: removed` with `{project, id}`, for one deleted;
 * - `event: board` with an `EverywhereBoard`, when a project's tasks moved;
 * - `event: projects`, when one was served since, to list again.
 */
export class EverywhereRoutes implements StreamWatcher, AsyncResource {
	private readonly listeners = new Set<EventSink>();
	/** Each served project heard, by root, while a stream is open. */
	private readonly heard = new Map<string, Resource>();
	private opening: Promise<void> | null = null;

	constructor(
		private readonly home: {
			projects: Projects;
			/** By root, as `dev` keeps them. */
			served: Map<string, Promise<Served>>;
			servedAt: (root: string) => Promise<Served>;
			log: Logger;
		},
	) {}

	/** `GET /api/everywhere`. */
	readonly list = async (): Promise<Response> => {
		void this.openAll();
		const listing: EverywhereListing = { projects: [] };
		for (const [root, project] of await this.servedNow()) {
			const board = await this.board(root, project);
			if (board !== null) {
				listing.projects.push({
					...board,
					conversations: (
						(await project.conversations?.list().catch(() => [])) ?? []
					).map(({ state }) => listed(state)),
				});
			}
		}
		listing.projects.sort((one, other) =>
			one.project.localeCompare(other.project),
		);
		return Response.json(listing);
	};

	/** `GET /api/everywhere/events`. */
	readonly events = async (): Promise<Response> => {
		void this.openAll();
		return eventStream(this.listeners, this);
	};

	/**
	 * Serves every registered project not yet served, one at a time; again
	 * on a later call, for any registered since. One that fails to open is
	 * logged and left.
	 */
	openAll(): Promise<void> {
		this.opening ??= (async () => {
			const { projects, served, servedAt, log } = this.home;
			for (const each of await projects.list()) {
				if (!each.gone && !served.has(each.root)) {
					await servedAt(each.root).catch((error: unknown) =>
						log.error(`${each.root} did not open: ${String(error)}`),
					);
				}
			}
		})().finally(() => {
			this.opening = null;
		});
		return this.opening;
	}

	/** The project at `root` is served now: the streams list again. */
	added(root: string, project: Served): void {
		if (this.listeners.size === 0) {
			return;
		}
		this.hear(root, project);
		this.say("event: projects\ndata: {}\n\n");
	}

	opened(): void {
		if (this.listeners.size !== 1) {
			return;
		}
		void this.servedNow().then((all) => {
			for (const [root, project] of all) {
				this.hear(root, project);
			}
		});
	}

	closed(): void {
		if (this.listeners.size > 0) {
			return;
		}
		for (const each of this.heard.values()) {
			each.dispose();
		}
		this.heard.clear();
	}

	async disposeAsync(): Promise<void> {
		this.closed();
	}

	/** Listens to the project at `root` while a stream is open, once. */
	private hear(root: string, project: Served): void {
		if (this.listeners.size === 0 || this.heard.has(root)) {
			return;
		}
		const slug = this.slugOf(root);
		this.heard.set(
			root,
			project.listen({
				changed: (conversation) =>
					void slug.then((project) =>
						this.say(
							`data: ${JSON.stringify({ project, conversation: listed(conversation) })}\n\n`,
						),
					),
				removed: (id) =>
					void slug.then((project) =>
						this.say(
							`event: removed\ndata: ${JSON.stringify({ project, id })}\n\n`,
						),
					),
				// The agents and their settings are each project's page's own.
				settings: () => {},
				board: () =>
					void this.board(root, project).then((board) => {
						if (board !== null) {
							this.say(`event: board\ndata: ${JSON.stringify(board)}\n\n`);
						}
					}),
			}),
		);
	}

	/** Every project served so far, those that failed to open left out. */
	private async servedNow(): Promise<[string, Served][]> {
		const all: [string, Served][] = [];
		for (const [root, opening] of this.home.served) {
			const project = await opening.catch(() => null);
			if (project !== null) {
				all.push([root, project]);
			}
		}
		return all;
	}

	/**
	 * What the feed carries of the project at `root`'s snapshot, kept as its
	 * pages read it; null when its records are past what this splates reads.
	 */
	private async board(
		root: string,
		project: Served,
	): Promise<EverywhereBoard | null> {
		try {
			await project.format.check();
			const { repo, trunk, tasks, laneNames } = await project.current();
			return {
				project: await this.slugOf(root),
				repo,
				root,
				trunk,
				tasks,
				laneNames,
			};
		} catch (error) {
			this.home.log.error(`${root} left out of every project's feed: ${error}`);
			return null;
		}
	}

	private async slugOf(root: string): Promise<string> {
		return (
			(await this.home.projects.list()).find((each) => each.root === root)
				?.slug ??
			root.split("/").filter(Boolean).at(-1) ??
			root
		);
	}

	private say(text: string): void {
		const chunk = encoder.encode(text);
		for (const stream of this.listeners) {
			stream.enqueue(chunk);
		}
	}
}

const encoder = new TextEncoder();
