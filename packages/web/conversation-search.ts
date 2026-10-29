import type { Said } from "@stringsync/splates-server/conversations";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, type Timer } from "webappwiz/time";
import { searchConversations } from "./conversation-api";

/** Where conversations' words are searched: the server, which holds them whole. */
export interface WordsServer {
	search(query: string, signal: AbortSignal): Promise<Record<string, Said>>;
}

const SERVER: WordsServer = { search: searchConversations };

/** How long typing pauses before the server is asked. */
const PAUSE = Duration.ms(150);

/**
 * What the server finds of ⌘K's query in each conversation's words, by its
 * id: asked once typing pauses, the last answer kept until the next, and a
 * question overtaken by more typing dropped.
 */
export class ConversationSearch
	implements Eventful<{ changed: undefined }>, Resource
{
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;
	/** The last answer; empty with nothing typed, or before the first. */
	said: Readonly<Record<string, Said>> = {};
	private waiting: Resource | null = null;
	private asking: AbortController | null = null;

	constructor(
		private readonly timer: Timer,
		private readonly server: WordsServer = SERVER,
	) {}

	/** Searches for `query` once typing pauses; nothing typed clears at once. */
	ask(query: string): void {
		this.cancel();
		if (query.trim() === "") {
			this.show({});
			return;
		}
		this.waiting = this.timer.setTimeout(() => {
			this.waiting = null;
			const asking = new AbortController();
			this.asking = asking;
			this.server.search(query, asking.signal).then(
				(said) => {
					if (this.asking === asking) {
						this.asking = null;
						this.show(said);
					}
				},
				// Unanswered, conversations still match on their names.
				() => {},
			);
		}, PAUSE);
	}

	dispose(): void {
		this.cancel();
	}

	private cancel(): void {
		this.waiting?.dispose();
		this.waiting = null;
		this.asking?.abort();
		this.asking = null;
	}

	private show(said: Readonly<Record<string, Said>>): void {
		this.said = said;
		this.dispatcher.dispatch("changed");
	}
}
