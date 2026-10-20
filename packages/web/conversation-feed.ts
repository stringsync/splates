import type {
	Attached,
	ConversationState,
	Image,
	Limit,
	Message,
	Setting,
	Taking,
} from "@stringsync/splates-server/conversations";
import {
	type ConversationDelta,
	ConversationUpdates,
} from "@stringsync/splates-server/conversations/browser";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import {
	Duration,
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import { scoped } from "./api";
import type { Expectation, Expecter } from "./expecting";
import { LiveStream } from "./live-stream";

/** How long a message goes unanswered before the page says it is still sending. */
export const STILL_SENDING = Duration.secs(3);

/** How long the page waits for a prompt acknowledgement. */
export const SEND_TIMEOUT = Duration.secs(30);

export type ConversationFeedEvents = { changed: undefined };

/** A message on its way: its words, and its files read from the page's own copies. */
export interface Sending {
	/** The page's id for it, which the server's own copy of it carries back. */
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
	/** When it was sent, as epoch ms, to tell when it has gone unanswered for `STILL_SENDING`. */
	at: number;
}

/** A message the server refused, with why: shown until sent again or taken back. */
export interface Unsent {
	message: Sending;
	why: string;
}

/**
 * The page's copy of every conversation, updated as the server streams it.
 * `available` stays false when the server holds no conversations. The phone
 * still keeps its Inbox as home.
 */
export class ConversationFeed
	implements Eventful<ConversationFeedEvents>, Expecter, Resource
{
	private readonly dispatcher = new Dispatcher<ConversationFeedEvents>();
	readonly events = this.dispatcher.events;

	/** Whether the first listing is still on its way. */
	loading = true;
	available = false;
	agents: AgentChoice[] = [];
	/** Newest first, each with the messages on their way (see `send`) as said. */
	conversations: ConversationState[] = [];
	/** Each conversation's messages on their way, by id, in the order sent. */
	readonly sending = new Map<string, Sending[]>();
	/** Each conversation's refused messages, in the order refused, replaced whole as they change. */
	readonly unsent = new Map<string, readonly Unsent[]>();

	/** Each conversation's changes on their way, by id, in the order made (see `expect`). */
	private readonly expected = new Map<string, Expected[]>();
	/** As the server last said, without what is on its way. */
	private recorded: ConversationState[] = [];
	/**
	 * How many changes `put` and `drop` have made, and the count at each
	 * conversation's last, so a listing knows what moved while it was on its
	 * way.
	 */
	private changes = 0;
	private readonly changedAt = new Map<string, number>();
	/** How many listings have started, so a listing knows which writes it follows. */
	private reads = 0;
	/** The conversations `whole` is reading, by id. */
	private readonly reading = new Set<string>();
	private stream: LiveStream | null = null;
	private readonly streamed = new Map<string, ConversationState>();

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
		this.streamed.clear();
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
		this.expected.clear();
	}

	/** Updates a conversation from a whole state or a streamed delta, adding new ones first. */
	put(update: ConversationState | ConversationDelta): void {
		const before =
			this.streamed.get(update.id) ??
			this.recorded.find((each) => each.id === update.id);
		if ("changes" in update && before === undefined) {
			return;
		}
		const state =
			"changes" in update
				? ConversationUpdates.apply(before as ConversationState, update)
				: update;
		if ("changes" in update) {
			this.streamed.set(state.id, state);
		}
		this.settle(state.id);
		this.changedAt.set(state.id, this.changes++);
		const at = this.recorded.findIndex((each) => each.id === state.id);
		this.show(
			at === -1
				? [state, ...this.recorded]
				: this.recorded.map((each, index) => (index === at ? state : each)),
		);
	}

	/**
	 * Reads conversation `id` whole when the page holds only its summary, as
	 * a listing sends an archived one, so its thread shows its tool calls.
	 */
	async whole(id: string): Promise<void> {
		const held = this.recorded.find((each) => each.id === id);
		if (held?.summary !== true || this.reading.has(id)) {
			return;
		}
		this.reading.add(id);
		try {
			const since = this.changes;
			const response = await fetch(
				`/api/conversations/${encodeURIComponent(id)}`,
			).catch(() => null);
			if (response?.ok && (this.changedAt.get(id) ?? -1) < since) {
				this.put((await response.json()) as ConversationState);
			}
		} finally {
			this.reading.delete(id);
		}
	}

	/** Drops conversation `id`, deleted as an older archived one. */
	drop(id: string): void {
		this.streamed.delete(id);
		this.changedAt.set(id, this.changes++);
		this.expected.delete(id);
		this.show(this.recorded.filter((each) => each.id !== id));
	}

	/**
	 * Shows `expectation` over conversation `id` at once, while `write`, the
	 * request that makes it, is on its way, so an action shows at the click
	 * rather than on the server's push. It stays over whatever the server
	 * streams meanwhile, and goes once `write` lands and the server's copy
	 * holds it, or the next copy streams: the server streams its state before
	 * it answers, so that copy is there or on its way. Refused, it goes at once
	 * and the promise rejects with why, for the caller to say. Every page
	 * action on a conversation's own state goes through here, so each shows
	 * the same way; `recorded` stays the server's word.
	 */
	async expect(
		id: string,
		expectation: Expectation,
		write: Promise<unknown>,
	): Promise<void> {
		const expected: Expected = {
			patch:
				typeof expectation === "function"
					? expectation
					: (state) => ({ ...state, ...expectation }),
			landedRead: null,
		};
		this.expected.set(id, [...(this.expected.get(id) ?? []), expected]);
		this.show(this.recorded);
		try {
			await write;
		} catch (error) {
			this.unexpect(id, expected);
			throw error;
		}
		expected.landedRead = this.reads;
		const held = this.recorded.find((each) => each.id === id);
		if (held === undefined || holds(held, expected.patch)) {
			this.unexpect(id, expected);
		}
	}

	/** Stops showing `expected` over conversation `id`. */
	private unexpect(id: string, expected: Expected): void {
		const left = (this.expected.get(id) ?? []).filter(
			(each) => each !== expected,
		);
		if (left.length === 0) {
			this.expected.delete(id);
		} else {
			this.expected.set(id, left);
		}
		this.show(this.recorded);
	}

	/**
	 * Gives up the changes whose writes landed before a copy of conversation
	 * `id` the server sent was asked for: that copy holds them, or the server
	 * made them otherwise. A streamed copy follows every write that has landed;
	 * a listing follows those that landed before it began, `read` being its
	 * count, since one begun earlier may predate them.
	 */
	private settle(id: string, read: number = Infinity): void {
		const left = (this.expected.get(id) ?? []).filter(
			(each) => each.landedRead === null || each.landedRead > read,
		);
		if (left.length === 0) {
			this.expected.delete(id);
		} else {
			this.expected.set(id, left);
		}
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
		const sending = this.sending.get(id);
		const message = {
			id: this.ids.next(),
			text,
			images: kept.filter((each) => SEEN.includes(each.mimeType)),
			files: kept.filter((each) => !SEEN.includes(each.mimeType)),
			queued: this.placed(id) === "queue" || sending !== undefined,
			typed,
			attached: files,
			dictated,
			at: this.wall.now(),
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
	 * Where a message said now to conversation `id` would go, as the server
	 * last said it will take one. Every place a message is put asks here, so
	 * what decides it stays in one spot.
	 */
	private placed(id: string): Taking {
		return this.recorded.find((each) => each.id === id)?.taking ?? "start";
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

	/**
	 * Settles `message`, which `send` showed in conversation `id`, by the
	 * server's answer `state` to it: when that holds the message, the server
	 * has it, so the page takes `state` in at once if the stream has yet to
	 * bring it, and gives up any unsent copy of it.
	 */
	answered(id: string, message: Sending, state: ConversationState): void {
		if (!state.messages?.some((each) => each.id === message.id)) {
			return;
		}
		if ((this.unsent.get(id) ?? []).some((each) => each.message === message)) {
			this.take(id, message);
		}
		const held = this.recorded.find((each) => each.id === id);
		if (!held?.messages.some((each) => each.id === message.id)) {
			this.put(state);
		}
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

	/**
	 * When conversation `id` next needs its sending countdown refreshed,
	 * as epoch ms; null when nothing is on its way.
	 */
	nextSlow(id: string): number | null {
		const now = this.wall.now();
		const due = (this.sending.get(id) ?? [])
			.map((each) =>
				now < each.at + STILL_SENDING.ms
					? each.at + STILL_SENDING.ms
					: each.at +
						(Math.floor((now - each.at) / Duration.secs(1).ms) + 1) *
							Duration.secs(1).ms,
			)
			.filter((at) => at > now);
		return due.length === 0 ? null : Math.min(...due);
	}

	/** Shows what is on its way afresh, as the clock now reads. */
	recheck(): void {
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
		this.conversations = recorded.map((each) =>
			(this.expected.get(each.id) ?? []).reduce(
				(state, { patch }) => patch(state),
				this.withSending(each),
			),
		);
		this.dispatcher.dispatch("changed");
	}

	/** `each` with its messages on their way said after its own. */
	private withSending(each: ConversationState): ConversationState {
		const sending = this.sending.get(each.id);
		if (sending === undefined) {
			return each;
		}
		// Its own copies by id, so what others said meanwhile, as an
		// `splates tell` or another device, never stands in for one.
		const kept = new Set(each.messages.map((message) => message.id));
		const left = sending.filter((message) => !kept.has(message.id));
		for (const message of sending.filter((each) => kept.has(each.id))) {
			forget(message);
		}
		if (left.length === 0) {
			this.sending.delete(each.id);
			return each;
		}
		this.sending.set(each.id, left);
		const now = this.wall.now();
		return {
			...each,
			messages: [...each.messages, ...left.map((copy) => messageOf(copy, now))],
		};
	}

	private async load(): Promise<void> {
		if (!(await this.list())) {
			return;
		}
		this.stream = new LiveStream(scoped("/api/conversations/events"), {
			message: (event) => {
				const state = JSON.parse(event.data) as ConversationState;
				this.streamed.set(state.id, state);
				this.put(state);
			},
			named: {
				delta: (event) => this.put(JSON.parse(event.data) as ConversationDelta),
				removed: (event) => this.drop(event.data),
				settings: () => void this.list(),
			},
			// Back after the stream dropped, as when `splates server` restarts or the
			// machine wakes: what the page holds may have moved meanwhile, so it
			// is read again whole.
			open: (again) => {
				this.streamed.clear();
				void this.reopened(again);
			},
		});
	}

	/**
	 * Reads every conversation afresh after the stream opens, `reconnect` when it
	 * had before. Messages sent before it dropped that the listing still lacks are given up as unsent:
	 * their requests may have died with the connection, and none would say so.
	 */
	private async reopened(reconnect: boolean): Promise<void> {
		const before = [...this.sending].flatMap(([id, each]) =>
			each.map((message) => ({ id, message })),
		);
		await this.list();
		if (!reconnect) {
			return;
		}
		for (const { id, message } of before) {
			this.refused(
				id,
				message,
				new Error("Lost the connection before the server had it"),
			);
		}
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
		const read = this.reads++;
		const response = await fetch(scoped("/api/conversations")).catch(
			() => null,
		);
		// Off, or a host that may not have them: either way, nothing to show.
		if (response === null || !response.ok) {
			this.loading = false;
			this.dispatcher.dispatch("changed");
			return false;
		}
		const { agents, conversations } = (await response.json()) as {
			agents: AgentChoice[];
			conversations: ConversationState[];
		};
		Object.assign(this, { available: true, loading: false, agents });
		// What streamed while the listing was on its way is newer than it, as
		// when the stream reopens and a message is said before this answers.
		const moved = (id: string) => (this.changedAt.get(id) ?? -1) >= since;
		const listed = new Set(conversations.map((each) => each.id));
		for (const id of listed) {
			if (!moved(id)) {
				this.settle(id, read);
			}
		}
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
export function messageOf(message: Sending, now = message.at): Message {
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
		...(now - message.at >= STILL_SENDING.ms
			? {
					sending: Math.max(
						0,
						Math.ceil(
							(SEND_TIMEOUT.ms - (now - message.at)) / Duration.secs(1).ms,
						),
					),
				}
			: {}),
		...(message.dictated ? { dictated: true as const } : {}),
	};
}

/** The images an agent that takes images is sent as such, as the server keeps them. */
export const SEEN = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** A change `expect` shows: how, and when its write landed. */
interface Expected {
	patch: (state: ConversationState) => ConversationState;
	/** `reads` as its write landed; null while it is on its way. */
	landedRead: number | null;
}

/** Whether `state` already holds what `patch` would change of it. */
function holds(
	state: ConversationState,
	patch: (state: ConversationState) => ConversationState,
): boolean {
	const patched = patch(state);
	return (Object.keys(patched) as (keyof ConversationState)[]).every(
		(key) =>
			patched[key] === state[key] ||
			JSON.stringify(patched[key]) === JSON.stringify(state[key]),
	);
}

/** Lets go of the page's copies of `message`'s files. */
function forget(message: Sending): void {
	for (const image of [...message.images, ...message.files]) {
		if (image.url !== undefined) {
			URL.revokeObjectURL(image.url);
		}
	}
}
