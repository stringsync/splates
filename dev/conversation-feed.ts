import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { ConversationState, Image, Setting } from "../conversations";
import { scoped } from "./api";

export type ConversationFeedEvents = { changed: undefined };

/** A message on its way: its words, and its images read from the page's own copies. */
export interface Sending {
	text: string;
	images: Image[];
}

/** An agent a conversation can be started with. */
export interface AgentChoice {
	id: string;
	name: string;
	/** The models the roster lists for it, by the ids its Model setting takes. */
	models?: { id: string; name: string }[];
	/**
	 * What its sessions last offered, from any project, each where it was
	 * left; none until it has had one on this machine.
	 */
	settings: Setting[];
}

/** What to call agent `id`: its name, or its id once it is off the roster. */
export function agentName(agents: AgentChoice[], id: string): string {
	return agents.find((agent) => agent.id === id)?.name ?? id;
}

/**
 * The page's copy of every conversation, each replaced whole as the server
 * streams it. `available` stays false when the server holds no
 * conversations, and the page then shows no Conversations at all.
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
	readonly sending = new Map<string, { messages: Sending[]; after: number }>();

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
		for (const { messages } of this.sending.values()) {
			messages.forEach(forget);
		}
		this.sending.clear();
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
	 * Shows `text` and `images` as said in conversation `id`, whose server holds it
	 * unrecorded until the agent is up, starting or resuming, so the thread
	 * does not sit as it was meanwhile. The first held there starts a turn and
	 * the rest wait for its end, so they show as queued, as the server will
	 * record them. Each goes once the server has recorded as many more
	 * messages from the person there, or `sent` says it was refused. The
	 * images show from the files themselves, as the server has yet to keep
	 * them.
	 */
	send(id: string, text: string, images: File[] = []): Sending {
		const message = {
			text,
			images: images.map((file) => ({
				name: file.name,
				mimeType: file.type,
				url: URL.createObjectURL(file),
			})),
		};
		const held = this.recorded.find((each) => each.id === id);
		const sending = this.sending.get(id);
		if (sending === undefined) {
			this.sending.set(id, { messages: [message], after: said(held) });
		} else {
			sending.messages.push(message);
		}
		this.show(this.recorded);
		return message;
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
		return sending.messages.length - Math.max(1, said(held) - sending.after);
	}

	/** Stops showing `message`, which `send` showed in conversation `id`. */
	sent(id: string, message: Sending): void {
		const sending = this.sending.get(id);
		const at = sending?.messages.indexOf(message) ?? -1;
		if (sending === undefined || at === -1) {
			return;
		}
		sending.messages.splice(at, 1);
		forget(message);
		if (sending.messages.length === 0) {
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
			if (recorded >= sending.messages.length) {
				this.sending.delete(each.id);
				sending.messages.forEach(forget);
				return each;
			}
			return {
				...each,
				messages: [
					...each.messages,
					...sending.messages.slice(recorded).map((message, index) => ({
						role: "user" as const,
						parts: [
							...message.images.map((image) => ({
								type: "image" as const,
								...image,
							})),
							...(message.text === ""
								? []
								: [{ type: "text" as const, text: message.text }]),
						],
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

/** Lets go of the page's copies of `message`'s images. */
function forget(message: Sending): void {
	for (const image of message.images) {
		if (image.url !== undefined) {
			URL.revokeObjectURL(image.url);
		}
	}
}
