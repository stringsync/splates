import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import {
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import type {
	Attached,
	ConversationState,
	Image,
	Limit,
	Setting,
} from "../conversations";
import { scoped } from "./api";
import { LiveStream } from "./live-stream";

export type ConversationFeedEvents = { changed: undefined };

/** A message on its way: its words, and its files read from the page's own copies. */
export interface Sending {
	text: string;
	images: Image[];
	files: Attached[];
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
	/**
	 * The plan's windows of use, as it last said in any project; none until
	 * it has, and never from an agent that does not say.
	 */
	limits: Limit[];
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
	/**
	 * How many changes `put` and `drop` have made, and the count at each
	 * conversation's last, so a listing knows what moved while it was on its
	 * way.
	 */
	private changes = 0;
	private readonly changedAt = new Map<string, number>();
	private stream: LiveStream | null = null;

	/** `timer` and `wall` are what the thread waits and reads the date by. */
	constructor(
		readonly timer: Timer = new SystemTimer(),
		readonly wall: WallClock = new SystemWallClock(),
	) {}

	start(): void {
		// React runs a mount effect twice in StrictMode, and a second stream would
		// leak the first.
		if (this.stream !== null) {
			return;
		}
		void this.load();
	}

	dispose(): void {
		this.stream?.dispose();
		this.stream = null;
		for (const { messages } of this.sending.values()) {
			messages.forEach(forget);
		}
		this.sending.clear();
	}

	/** Puts `state` in place of what the page had of it, or first when new. */
	put(state: ConversationState): void {
		this.changedAt.set(state.id, this.changes++);
		const at = this.recorded.findIndex((each) => each.id === state.id);
		this.show(
			at === -1
				? [state, ...this.recorded]
				: this.recorded.map((each, index) => (index === at ? state : each)),
		);
	}

	/** Drops conversation `id`, deleted as an older archived one. */
	drop(id: string): void {
		this.changedAt.set(id, this.changes++);
		this.show(this.recorded.filter((each) => each.id !== id));
	}

	/**
	 * Shows `text` and `files` as said in conversation `id`, whose server holds it
	 * unrecorded until the agent is up, starting or resuming, so the thread
	 * does not sit as it was meanwhile. The first held there starts a turn and
	 * the rest wait for its end, so they show as queued, as the server will
	 * record them. Each goes once the server has recorded as many more
	 * messages from the person there, or `sent` says it was refused. The
	 * files show from the page's own, as the server has yet to keep them.
	 */
	send(id: string, text: string, files: File[] = []): Sending {
		const kept = files.map((file) => ({
			name: file.name,
			title: file.name,
			mimeType: file.type,
			url: URL.createObjectURL(file),
		}));
		const message = {
			text,
			images: kept.filter((each) => SEEN.includes(each.mimeType)),
			files: kept.filter((each) => !SEEN.includes(each.mimeType)),
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
							...message.files.map((file) => ({
								type: "file" as const,
								...file,
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
		this.stream = new LiveStream(scoped("/api/conversations/events"), {
			message: (event) => this.put(JSON.parse(event.data) as ConversationState),
			named: { removed: (event) => this.drop(event.data) },
			// Back after the stream dropped, as when `arbor dev` restarts or the
			// machine wakes: what the page holds may have moved meanwhile, so it
			// is read again whole.
			open: () => void this.list(),
		});
	}

	/**
	 * Has the server ask the agents that do not send their limits for them,
	 * then reads the agents afresh, so the page shows what they said.
	 */
	async refreshLimits(): Promise<void> {
		await fetch(scoped("/api/conversations/limits"), { method: "POST" }).catch(
			() => null,
		);
		await this.list();
	}

	/** Reads every conversation afresh; false when they are off. */
	private async list(): Promise<boolean> {
		const since = this.changes;
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
		// What streamed while the listing was on its way is newer than it, as
		// when the stream reopens and a message is said before this answers.
		const moved = (id: string) => (this.changedAt.get(id) ?? -1) >= since;
		const listed = new Set(conversations.map((each) => each.id));
		this.show([
			...this.recorded.filter((each) => moved(each.id) && !listed.has(each.id)),
			...conversations.flatMap((each) =>
				moved(each.id)
					? this.recorded.filter((kept) => kept.id === each.id)
					: [each],
			),
		]);
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

/** The images an agent that takes images is sent as such, as the server keeps them. */
export const SEEN = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Lets go of the page's copies of `message`'s files. */
function forget(message: Sending): void {
	for (const image of [...message.images, ...message.files]) {
		if (image.url !== undefined) {
			URL.revokeObjectURL(image.url);
		}
	}
}
