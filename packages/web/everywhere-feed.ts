import type { ConversationState } from "@stringsync/splates/conversations";
import type {
	EverywhereBoard,
	EverywhereListing,
	EverywhereProject,
} from "@stringsync/splates/dev-everywhere";
import type { Details } from "@stringsync/splates/show";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { LiveStream } from "./live-stream";

export type EverywhereFeedEvents = { changed: undefined };

/** `T` with the slug of the project it is in, as `?project=` names it. */
export type InProject<T> = T & { project: string };

/** A project the feed holds, without its tasks and conversations. */
export type EverywhereSummary = Omit<
	EverywhereProject,
	"tasks" | "conversations"
>;

/**
 * Every registered project's tasks and conversations, each tagged with its
 * project's slug, as `/api/everywhere` lists them and its stream moves
 * them: what the page reads to show them across projects. Read-only: a
 * write goes to the item's own project, and the stream brings it back.
 *
 * One for the page, outliving a switch of project: it streams only while
 * `hold` has a holder, since the server watches every project for it.
 */
export class EverywhereFeed implements Eventful<EverywhereFeedEvents> {
	private readonly dispatcher = new Dispatcher<EverywhereFeedEvents>();
	readonly events = this.dispatcher.events;

	/** Whether the first listing is still on its way. */
	loading = true;
	/** False while the server refuses it, as through a tunnel with no Access. */
	available = false;
	/** By slug, alphabetically. */
	projects: EverywhereSummary[] = [];
	/** Every project's, its projects in `projects`' order. */
	tasks: InProject<Details>[] = [];
	/** Every project's, newest first within each, its projects in `projects`' order. */
	conversations: InProject<ConversationState>[] = [];

	/** As the server last said, by slug. */
	private held = new Map<string, EverywhereProject>();
	/**
	 * How many changes the stream has made, and the count at each item's
	 * last, so a listing knows what moved while it was on its way.
	 */
	private changes = 0;
	private readonly changedAt = new Map<string, number>();
	private stream: LiveStream | null = null;
	private holders = 0;

	/** Streams until the last holder disposes what this returns. */
	hold(): Resource {
		if (this.holders++ === 0) {
			this.start();
		}
		let held = true;
		return {
			dispose: () => {
				if (held) {
					held = false;
					if (--this.holders === 0) {
						this.stream?.dispose();
						this.stream = null;
					}
				}
			},
		};
	}

	/** The project `slug` names, or undefined for one the feed has not heard of. */
	project(slug: string): EverywhereSummary | undefined {
		return this.projects.find((each) => each.project === slug);
	}

	private start(): void {
		this.stream = new LiveStream("/api/everywhere/events", {
			message: (event) => {
				const { project, conversation } = JSON.parse(event.data) as {
					project: string;
					conversation: ConversationState;
				};
				this.put(project, conversation);
			},
			named: {
				removed: (event) => {
					const { project, id } = JSON.parse(event.data) as {
						project: string;
						id: string;
					};
					this.drop(project, id);
				},
				board: (event) => this.board(JSON.parse(event.data) as EverywhereBoard),
				projects: () => void this.list(),
			},
			// Each open, the first too: what moved while it was away was never said.
			open: () => void this.list(),
		});
	}

	private put(slug: string, state: ConversationState): void {
		const held = this.held.get(slug);
		if (held === undefined) {
			// A project not listed yet: the listing its stream asks for brings it.
			return;
		}
		this.changedAt.set(`${slug}/${state.id}`, this.changes++);
		const at = held.conversations.findIndex((each) => each.id === state.id);
		this.held.set(slug, {
			...held,
			conversations:
				at === -1
					? [state, ...held.conversations]
					: held.conversations.map((each, index) =>
							index === at ? state : each,
						),
		});
		this.show();
	}

	private drop(slug: string, id: string): void {
		const held = this.held.get(slug);
		if (held === undefined) {
			return;
		}
		this.changedAt.set(`${slug}/${id}`, this.changes++);
		this.held.set(slug, {
			...held,
			conversations: held.conversations.filter((each) => each.id !== id),
		});
		this.show();
	}

	private board(board: EverywhereBoard): void {
		const held = this.held.get(board.project);
		this.changedAt.set(board.project, this.changes++);
		this.held.set(board.project, {
			...board,
			conversations: held?.conversations ?? [],
		});
		this.show();
	}

	/** Reads every project afresh, keeping what streamed while it was on its way. */
	private async list(): Promise<void> {
		const since = this.changes;
		const response = await fetch("/api/everywhere").catch(() => null);
		if (response === null || !response.ok) {
			this.loading = false;
			this.dispatcher.dispatch("changed");
			return;
		}
		const { projects } = (await response.json()) as EverywhereListing;
		const moved = (key: string) => (this.changedAt.get(key) ?? -1) >= since;
		const next = new Map<string, EverywhereProject>();
		for (const listed of projects) {
			const kept = this.held.get(listed.project);
			const board = moved(listed.project) && kept ? kept : listed;
			const ids = new Set(listed.conversations.map((each) => each.id));
			const fresh = (kept?.conversations ?? []).filter(
				(each) => !ids.has(each.id) && moved(`${listed.project}/${each.id}`),
			);
			next.set(listed.project, {
				...board,
				conversations: [
					...fresh,
					...listed.conversations.flatMap((each) =>
						moved(`${listed.project}/${each.id}`)
							? (kept?.conversations ?? []).filter(
									(mine) => mine.id === each.id,
								)
							: [each],
					),
				],
			});
		}
		this.held = next;
		this.available = true;
		this.loading = false;
		this.show();
	}

	private show(): void {
		const all = [...this.held.values()].sort((one, other) =>
			one.project.localeCompare(other.project),
		);
		this.projects = all.map(({ tasks, conversations, ...summary }) => summary);
		this.tasks = all.flatMap(({ project, tasks }) =>
			tasks.map((task) => ({ ...task, project })),
		);
		this.conversations = all.flatMap(({ project, conversations }) =>
			conversations.map((conversation) => ({ ...conversation, project })),
		);
		this.dispatcher.dispatch("changed");
	}
}
