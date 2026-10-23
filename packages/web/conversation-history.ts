import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { ApiError, answered, scoped } from "./api";
import type { ConversationFeed } from "./conversation-feed";
import { messageOf } from "./sending";

/** Complete history kept across refreshes, and the selected histories being read. */
export class ConversationHistory
	implements Eventful<{ changed: undefined }>, Resource
{
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;
	private readonly complete = new Map<string, ConversationState>();
	private readonly errors = new Map<string, string>();
	private readonly reading = new Map<string, Promise<void>>();
	private generation = 0;

	constructor(
		private readonly feed: ConversationFeed,
		private readonly project: string | null,
	) {}

	/** The last complete copy, so a listing refresh cannot blank an open thread. */
	kept(id: string): ConversationState | undefined {
		return this.complete.get(id);
	}

	/** Keeps the complete body while controls and messages on their way still update immediately. */
	shown(state: ConversationState): ConversationState {
		const kept = this.complete.get(state.id);
		if (state.summary !== true || kept === undefined) {
			return state;
		}
		const { summary: _, ...latest } = state;
		return {
			...latest,
			messages: [
				...kept.messages,
				...(this.feed.sending.get(state.id) ?? []).map((each) =>
					messageOf(each, this.feed.wall.now()),
				),
			],
			events: kept.events,
			commands: kept.commands,
		};
	}

	/** Why this history could not be read; cleared when it arrives or is retried. */
	failure(id: string): string | null {
		return this.errors.get(id) ?? null;
	}

	/** Keeps only histories still listed, without replacing complete content with summaries. */
	remember(states: ConversationState[]): void {
		const ids = new Set(states.map((each) => each.id));
		for (const id of this.complete.keys()) {
			if (!ids.has(id)) {
				this.complete.delete(id);
			}
		}
		for (const id of this.errors.keys()) {
			if (!ids.has(id)) {
				this.errors.delete(id);
			}
		}
		for (const state of states) {
			if (state.summary !== true) {
				this.complete.set(state.id, state);
				this.errors.delete(state.id);
			}
		}
		this.dispatcher.dispatch("changed");
	}

	/** Reads only a requested summary, sharing its request and exposing failure for retry. */
	read(id: string): Promise<void> {
		const pending = this.reading.get(id);
		if (pending !== undefined) {
			return pending;
		}
		if (this.feed.current(id)?.summary !== true) {
			return Promise.resolve();
		}
		this.errors.delete(id);
		const generation = this.generation;
		const reading = this.fetch(id, generation)
			.catch((error: unknown) => {
				if (
					generation === this.generation &&
					this.feed.current(id)?.summary === true
				) {
					this.errors.set(
						id,
						error instanceof Error
							? error.message
							: "Couldn't load conversation history.",
					);
				}
			})
			.finally(() => {
				if (this.reading.get(id) === reading) {
					this.reading.delete(id);
				}
				this.dispatcher.dispatch("changed");
			});
		this.reading.set(id, reading);
		this.dispatcher.dispatch("changed");
		return reading;
	}

	/** A summary received mid-read is newer; bounded retries leave a busy thread recoverable. */
	private async fetch(id: string, generation: number): Promise<void> {
		for (let attempt = 0; attempt < 3; attempt++) {
			const revision = this.feed.revision(id);
			const response = await answered(
				scoped(`/api/conversations/${encodeURIComponent(id)}`, this.project),
			);
			if (!response.ok) {
				throw new ApiError(
					response.status === 404 ? "not_found" : "error",
					response.status === 404
						? "This conversation is no longer available."
						: "Couldn't load conversation history.",
				);
			}
			const state = (await response.json()) as ConversationState;
			if (generation !== this.generation) {
				return;
			}
			if (
				state.id !== id ||
				state.summary === true ||
				!Array.isArray(state.messages)
			) {
				throw new Error("Couldn't load complete conversation history.");
			}
			if (this.feed.revision(id) === revision) {
				this.feed.put(state);
				return;
			}
			if (this.feed.current(id)?.summary !== true) {
				return;
			}
		}
		throw new Error("Conversation history changed while loading. Try again.");
	}

	dispose(): void {
		this.generation++;
		this.reading.clear();
		this.errors.clear();
		this.complete.clear();
	}
}
