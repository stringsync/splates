import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { ConversationState } from "../conversations";
import { scoped } from "./api";

export type ConversationFeedEvents = { changed: undefined };

/** An agent a conversation can be started with. */
export interface AgentChoice {
	id: string;
	name: string;
}

/**
 * The page's copy of every conversation, each replaced whole as the server
 * streams it. `available` stays false when `arbor dev` runs without
 * `--experimental`, and the page then shows no Conversations at all.
 */
export class ConversationFeed
	implements Eventful<ConversationFeedEvents>, Resource
{
	private readonly dispatcher = new Dispatcher<ConversationFeedEvents>();
	readonly events = this.dispatcher.events;

	available = false;
	agents: AgentChoice[] = [];
	/** Newest first. */
	conversations: ConversationState[] = [];

	private stream: EventSource | null = null;

	start(): void {
		// React runs a mount effect twice in StrictMode, and a second stream would
		// leak the first.
		if (this.stream !== null) {
			return;
		}
		void this.load();
	}

	dispose(): void {
		this.stream?.close();
		this.stream = null;
	}

	/** Puts `state` in place of what the page had of it, or first when new. */
	put(state: ConversationState): void {
		const at = this.conversations.findIndex((each) => each.id === state.id);
		this.conversations =
			at === -1
				? [state, ...this.conversations]
				: this.conversations.map((each, index) =>
						index === at ? state : each,
					);
		this.dispatcher.dispatch("changed");
	}

	private async load(): Promise<void> {
		if (!(await this.list())) {
			return;
		}
		const stream = new EventSource(scoped("/api/conversations/events"));
		this.stream = stream;
		stream.onmessage = (event: MessageEvent<string>) =>
			this.put(JSON.parse(event.data) as ConversationState);
		// Back after the stream dropped, as when `arbor dev` restarts: what the
		// page holds may have moved meanwhile, so it is read again whole.
		stream.onopen = () => void this.list();
	}

	/** Reads every conversation afresh; false when they are off. */
	private async list(): Promise<boolean> {
		const response = await fetch(scoped("/api/conversations")).catch(
			() => null,
		);
		// Off, or a host that may not have them: either way, nothing to show.
		if (response === null || !response.ok) {
			return false;
		}
		const { agents, conversations } = (await response.json()) as {
			agents: AgentChoice[];
			conversations: ConversationState[];
		};
		Object.assign(this, { available: true, agents, conversations });
		this.dispatcher.dispatch("changed");
		return true;
	}
}
