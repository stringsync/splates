import { Disposer, type Resource } from "webappwiz/disposable";
import { Duration, SystemTimer, Throttler } from "webappwiz/time";
import { type EventSink, eventStream } from "../server/shared";
import type { Conversations } from "./conversations";
import type { ConversationState } from "./state";
import { ConversationUpdates } from "./updates";

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
 * Streams each project's conversations at most once per beat. Pages receive
 * full copies when they connect, then deltas; other listeners receive states.
 */
export class ConversationStream implements Resource {
	private readonly pages = new Set<EventSink>();
	private readonly copies = new Map<EventSink, ConversationUpdates>();
	private readonly heard = new Set<ConversationsHeard>();
	/** Each conversation's beat, by id, while it lives. */
	private readonly beats = new Map<string, Throttler>();
	private readonly disposer = new Disposer();

	constructor(private readonly conversations: Conversations) {
		const timer = new SystemTimer();
		this.heard.add({
			changed: (state) => this.changed(state),
			removed: (id) => {
				for (const copy of this.copies.values()) {
					copy.drop(id);
				}
				this.send(`event: removed\ndata: ${id}\n\n`);
			},
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
		return eventStream(this.pages, {
			opened: () => {
				for (const sink of this.pages) {
					if (this.copies.has(sink)) {
						continue;
					}
					this.copies.set(sink, new ConversationUpdates());
					void this.conversations.list().then((all) => {
						if (this.pages.has(sink)) {
							for (const { state } of all) {
								this.write(sink, state);
							}
						}
					});
				}
			},
			closed: () => {
				for (const sink of this.copies.keys()) {
					if (!this.pages.has(sink)) {
						this.copies.delete(sink);
					}
				}
			},
		});
	}

	/** Tells `heard` of each change a page hears, until the returned function is called. */
	listen(heard: ConversationsHeard): () => void {
		this.heard.add(heard);
		return () => this.heard.delete(heard);
	}

	dispose(): void {
		this.disposer.dispose();
	}

	private changed(state: ConversationState): void {
		for (const sink of this.pages) {
			this.write(sink, state);
		}
	}

	private write(sink: EventSink, state: ConversationState): void {
		const update = this.copies.get(sink)?.next(state);
		if (update !== undefined) {
			sink.enqueue(
				encoder.encode(
					`${"changes" in update ? "event: delta\n" : ""}data: ${JSON.stringify(update)}\n\n`,
				),
			);
		}
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
