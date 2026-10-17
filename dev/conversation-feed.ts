import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type IdProvider, UuidProvider } from "webappwiz/id";
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
	Message,
	Setting,
} from "../conversations";
import { scoped } from "./api";
import { LiveStream } from "./live-stream";

export type ConversationFeedEvents = { changed: undefined };

/** A message on its way: its words, and its files read from the page's own copies. */
export interface Sending {
	/**
	 * The page's id for it, sent with it for the server to keep on its own
	 * copy, which is how the page knows that copy when it comes back.
	 */
	id: string;
	text: string;
	images: Image[];
	files: Attached[];
	/** Whether it waits for the running turn's end, as the server will record it. */
	queued: boolean;
	/** What the person wrote and attached, to send again or take back. */
	typed: string;
	attached: File[];
	/** Whether the person said it into the mic. */
	dictated: boolean;
}

/** A message the server refused, with why: shown until sent again or taken back. */
export interface Unsent {
	message: Sending;
	why: string;
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
	/** Each conversation's messages on their way, by id, in the order sent. */
	readonly sending = new Map<string, Sending[]>();
	/** Each conversation's refused messages, in the order refused, replaced whole as they change. */
	readonly unsent = new Map<string, readonly Unsent[]>();

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

	/**
	 * `timer` and `wall` are what the thread waits and reads the date by;
	 * `ids` names each message on its way.
	 */
	constructor(
		readonly timer: Timer = new SystemTimer(),
		readonly wall: WallClock = new SystemWallClock(),
		private readonly ids: IdProvider = new UuidProvider(),
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
		for (const messages of this.sending.values()) {
			messages.forEach(forget);
		}
		this.sending.clear();
		for (const each of this.unsent.values()) {
			for (const { message } of each) {
				forget(message);
			}
		}
		this.unsent.clear();
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
	 * Shows `text` and `files` as said in conversation `id` before its server
	 * records them, which waits on the way there and, while the agent starts
	 * or resumes, until it is up, so the thread does not sit as it was
	 * meanwhile. Said while a turn runs, or behind another on its way, it shows
	 * as queued, as the server records it unless the agent takes it into the
	 * turn, when its echo moves it into the thread. Each goes once the server
	 * has recorded a message with its id, whatever else it records meanwhile,
	 * or `refused` keeps it as unsent. The files show from the page's own, as the server
	 * has yet to keep them. `typed` is the text as the person wrote it, before
	 * the notes on its images were added.
	 */
	send(
		id: string,
		text: string,
		files: File[] = [],
		typed = text,
		dictated = false,
	): Sending {
		const kept = files.map((file) => ({
			name: file.name,
			title: file.name,
			mimeType: file.type,
			url: URL.createObjectURL(file),
		}));
		const held = this.recorded.find((each) => each.id === id);
		const sending = this.sending.get(id);
		const message = {
			id: this.ids.next(),
			text,
			images: kept.filter((each) => SEEN.includes(each.mimeType)),
			files: kept.filter((each) => !SEEN.includes(each.mimeType)),
			queued: held?.status === "running" || sending !== undefined,
			typed,
			attached: files,
			dictated,
		};
		if (sending === undefined) {
			this.sending.set(id, [message]);
		} else {
			sending.push(message);
		}
		this.show(this.recorded);
		return message;
	}

	/**
	 * How many of conversation `id`'s queued messages are still on their way,
	 * the last ones: the server has nothing of them to take back yet.
	 */
	unrecorded(id: string): number {
		return (this.sending.get(id) ?? []).filter((each) => each.queued).length;
	}

	/**
	 * Keeps `message`, which `send` showed in conversation `id`, as unsent at
	 * the thread's foot, since the server refused it with `error`.
	 */
	refused(id: string, message: Sending, error: unknown): void {
		if (!this.withdraw(id, message)) {
			return;
		}
		this.unsent.set(id, [
			...(this.unsent.get(id) ?? []),
			{
				message,
				why: error instanceof Error ? error.message : String(error),
			},
		]);
		this.show(this.recorded);
	}

	/** Stops showing `message`, unsent in conversation `id`, to send again or edit. */
	take(id: string, message: Sending): void {
		const left = (this.unsent.get(id) ?? []).filter(
			(each) => each.message !== message,
		);
		if (left.length === 0) {
			this.unsent.delete(id);
		} else {
			this.unsent.set(id, left);
		}
		forget(message);
		this.show(this.recorded);
	}

	/** Takes `message` off conversation `id`'s on their way; false when it was not. */
	private withdraw(id: string, message: Sending): boolean {
		const sending = this.sending.get(id);
		const at = sending?.indexOf(message) ?? -1;
		if (sending === undefined || at === -1) {
			return false;
		}
		sending.splice(at, 1);
		if (sending.length === 0) {
			this.sending.delete(id);
		}
		return true;
	}

	private show(recorded: ConversationState[]): void {
		this.recorded = recorded;
		this.conversations = recorded.map((each) => {
			const sending = this.sending.get(each.id);
			if (sending === undefined) {
				return each;
			}
			// Its own copies by id, so what others said meanwhile, as an
			// `arbor tell` or another device, never stands in for one.
			const kept = new Set(each.messages.map((message) => message.id));
			const left = sending.filter((message) => !kept.has(message.id));
			sending.filter((message) => kept.has(message.id)).forEach(forget);
			if (left.length === 0) {
				this.sending.delete(each.id);
				return each;
			}
			this.sending.set(each.id, left);
			return { ...each, messages: [...each.messages, ...left.map(messageOf)] };
		});
		this.dispatcher.dispatch("changed");
	}

	private async load(): Promise<void> {
		if (!(await this.list())) {
			return;
		}
		this.stream = new LiveStream(scoped("/api/conversations/events"), {
			message: (event) => this.put(JSON.parse(event.data) as ConversationState),
			named: {
				removed: (event) => this.drop(event.data),
				settings: () => void this.list(),
			},
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

/** `message` as the thread shows it, from the page's own copies of its files. */
export function messageOf(message: Sending): Message {
	return {
		id: message.id,
		role: "user",
		parts: [
			...message.images.map((image) => ({ type: "image" as const, ...image })),
			...message.files.map((file) => ({ type: "file" as const, ...file })),
			...(message.text === ""
				? []
				: [{ type: "text" as const, text: message.text }]),
		],
		plan: null,
		at: null,
		until: null,
		...(message.queued ? { queued: true as const } : {}),
		...(message.dictated ? { dictated: true as const } : {}),
	};
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
