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
	/** Newest first, each with the messages on their way (see `send`) as said. */
	conversations: ConversationState[] = [];
	/**
	 * Each conversation's messages on their way, by id, in the order sent,
	 * with how many the person had said there when they sent the first.
	 */
	readonly sending = new Map<string, { texts: string[]; after: number }>();

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
	 * does not sit as it was meanwhile. The first held there starts a turn and
	 * the rest wait for its end, so they show as queued, as the server will
	 * record them. Each goes once the server has recorded as many more
	 * messages from the person there, or `sent` says it was refused.
	 */
	send(id: string, text: string): void {
		const held = this.recorded.find((each) => each.id === id);
		const sending = this.sending.get(id);
		if (sending === undefined) {
			this.sending.set(id, { texts: [text], after: said(held) });
		} else {
			sending.texts.push(text);
		}
		this.show(this.recorded);
	}

	/**
	 * How many of conversation `id`'s queued messages are still on their way,
	 * the last ones: the server has nothing of them to take back yet.
	 */
	unrecorded(id: string): number {
		const sending = this.sending.get(id);
		if (sending === undefined) {
			return 0;
		}
		const held = this.recorded.find((each) => each.id === id);
		// All but the first, which starts the turn, less those recorded since.
		return sending.texts.length - Math.max(1, said(held) - sending.after);
	}

	/** Stops showing `text`, which `send` showed in conversation `id`. */
	sent(id: string, text: string): void {
		const sending = this.sending.get(id);
		const at = sending?.texts.indexOf(text) ?? -1;
		if (sending === undefined || at === -1) {
			return;
		}
		sending.texts.splice(at, 1);
		if (sending.texts.length === 0) {
			this.sending.delete(id);
		}
		this.show(this.recorded);
	}

	private show(recorded: ConversationState[]): void {
		this.recorded = recorded;
		this.conversations = recorded.map((each) => {
			const sending = this.sending.get(each.id);
			if (sending === undefined) {
				return each;
			}
			const recorded = said(each) - sending.after;
			if (recorded >= sending.texts.length) {
				this.sending.delete(each.id);
				return each;
			}
			return {
				...each,
				messages: [
					...each.messages,
					...sending.texts.slice(recorded).map((text, index) => ({
						role: "user" as const,
						parts: [{ type: "text" as const, text }],
						plan: null,
						at: null,
						until: null,
						...(recorded + index > 0 ? { queued: true as const } : {}),
					})),
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
