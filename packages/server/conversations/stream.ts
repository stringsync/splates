import { Disposer, type Resource } from "webappwiz/disposable";
import { Duration, SystemTimer, Throttler } from "webappwiz/time";
import { type EventSink, eventStream } from "../dev-http";
import type { Conversations } from "./conversations";
import type { ConversationState } from "./state";

/** What a listener hears of a project's conversations. */
export interface ConversationsHeard {
	/** A conversation, whole, as it is now. */
	changed(state: ConversationState): void;
	/** An older archived conversation, deleted. */
	removed(id: string): void;
	/** The agents' saved settings or limits moved. */
	settings(): void;
}

/**
 * Each change to a project's conversations, to its pages' streams and to
 * whatever else listens, such as the every-project feed. Each change
 * carries the whole conversation, since an agent streams in small pieces
 * and a page refetching after each would fall behind. At most one per
 * conversation per beat, the latest, which holds everything before.
 */
export class ConversationStream implements Resource {
	private readonly pages = new Set<EventSink>();
	private readonly heard = new Set<ConversationsHeard>();
	/** Each conversation's beat, by id, while it lives. */
	private readonly beats = new Map<string, Throttler>();
	private readonly disposer = new Disposer();

	constructor(conversations: Conversations) {
		const timer = new SystemTimer();
		this.heard.add({
			changed: (state) => this.send(`data: ${JSON.stringify(state)}\n\n`),
			removed: (id) => this.send(`event: removed\ndata: ${id}\n\n`),
			settings: () => this.send("event: settings\ndata: {}\n\n"),
		});
		this.disposer.defer(() => this.heard.clear());
		this.disposer.defer(() => {
			for (const beat of this.beats.values()) {
				beat.dispose();
			}
		});
		for (const unlisten of [
			conversations.events.on("settings", () => {
				for (const heard of this.heard) {
					heard.settings();
				}
			}),
			conversations.events.on("changed", (id) => {
				const beat = this.beats.get(id) ?? new Throttler(timer, BEAT);
				this.beats.set(id, beat);
				beat.call(async () => {
					// Gone meanwhile, deleted as an older archived one: `removed` says so.
					const state = (await conversations.list()).find(
						(each) => each.id === id,
					)?.state;
					if (state !== undefined) {
						for (const heard of this.heard) {
							heard.changed(state);
						}
					}
				});
			}),
			// An older archived conversation, deleted: the page drops it.
			conversations.events.on("removed", (id) => {
				this.beats.get(id)?.dispose();
				this.beats.delete(id);
				for (const heard of this.heard) {
					heard.removed(id);
				}
			}),
		]) {
			this.disposer.defer(unlisten);
		}
	}

	/** The stream a page listens to. */
	events(): Response {
		return eventStream(this.pages);
	}

	/** Tells `heard` of each change a page hears, until the returned function is called. */
	listen(heard: ConversationsHeard): () => void {
		this.heard.add(heard);
		return () => this.heard.delete(heard);
	}

	dispose(): void {
		this.disposer.dispose();
	}

	private send(text: string): void {
		const chunk = encoder.encode(text);
		for (const stream of this.pages) {
			stream.enqueue(chunk);
		}
	}
}

/** How often an open page hears about one conversation while its agent streams. */
const BEAT = Duration.ms(50);

const encoder = new TextEncoder();
