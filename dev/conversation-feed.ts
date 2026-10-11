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
	/** Newest first, each with the message on its way (see `send`) as said. */
	conversations: ConversationState[] = [];
	/**
	 * Each conversation's message on its way, by id, with how many the person
	 * had said there when they sent it.
	 */
	readonly sending = new Map<string, { text: string; after: number }>();

	/** As the server last said, without what is on its way. */
	private recorded: ConversationState[] = [];
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
		const at = this.recorded.findIndex((each) => each.id === state.id);
		this.show(
			at === -1
				? [state, ...this.recorded]
				: this.recorded.map((each, index) => (index === at ? state : each)),
		);
	}

	/**
	 * Shows `text` as said in conversation `id`, whose server holds it
	 * unrecorded until the agent is up, starting or resuming, so the thread
	 * does not sit as it was meanwhile. It goes once the server has one more
	 * message from the person there, or `sent` says it was refused.
	 */
	send(id: string, text: string): void {
		const held = this.recorded.find((each) => each.id === id);
		this.sending.set(id, { text, after: said(held) });
		this.show(this.recorded);
	}

	/** Stops showing what `send` showed in conversation `id`. */
	sent(id: string): void {
		if (this.sending.delete(id)) {
			this.show(this.recorded);
		}
	}

	private show(recorded: ConversationState[]): void {
		this.recorded = recorded;
		this.conversations = recorded.map((each) => {
			const sending = this.sending.get(each.id);
			if (sending === undefined) {
				return each;
			}
			if (said(each) > sending.after) {
				this.sending.delete(each.id);
				return each;
			}
			return {
				...each,
				messages: [
					...each.messages,
					{
						role: "user",
						parts: [{ type: "text", text: sending.text }],
						plan: null,
						at: null,
						until: null,
					},
				],
			};
		});
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
		Object.assign(this, { available: true, agents });
		this.show(conversations);
		return true;
	}
}

/** How many messages the person has said in `conversation`, if any. */
function said(conversation: ConversationState | undefined): number {
	return (
		conversation?.messages.filter((message) => message.role === "user")
			.length ?? 0
	);
}
