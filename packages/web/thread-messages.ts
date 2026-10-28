import type { ThreadMessageLike } from "@assistant-ui/react";
import type {
	ConversationState,
	Message,
	Part,
} from "@stringsync/splates-server/conversations";
import type { TaskReport } from "@stringsync/splates-server/plans/browser";
import type { Event } from "@stringsync/splates-server/records";
import { isEscalation } from "@stringsync/splates-server/records/browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Duration } from "webappwiz/time";
import { conversationAttachment } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { carriesOn } from "./directives";
import { heldPrompt, queuedReply } from "./queued-time";
import { messageOf } from "./sending";
import { replied, withEscalation } from "./thread-reply";
import { turnsOf } from "./thread-turns";
import { replyDue, stretchesOf } from "./work";
import { workingTimes } from "./working-report-time";

/** One part of a message as assistant-ui takes it. */
type LikePart = Exclude<ThreadMessageLike["content"], string>[number];

/**
 * What a conversation's thread shows: its messages as assistant-ui takes
 * them, with the reply's place held while the agent has yet to speak. A
 * running turn's queue stays out, for the panel above the composer.
 */
export function useThreadMessages(
	conversation: ConversationState,
	feed: ConversationFeed,
): ThreadMessages {
	const { id, status } = conversation;
	// Only once the server says the agent works: a message still on its way
	// has not reached a turn to cancel. Its reply's place is held all the
	// same (`going`), as the agent is about to answer it.
	const running = status === "running";
	const unsent = feed.unsent.get(id);
	const going = (feed.sending.get(id) ?? []).some((each) => !each.queued);
	// The last message is still being written while the agent works. An agent
	// starting is coming back to answer a prompt, never to go on with the turn
	// it last ended, which a lost connection may have cut short.
	const writing = status === "running";
	// What waits for the turn's end, which the person can take back.
	const queued = conversation.messages.filter((each) => each.queued);
	// The latest words wait a moment to show as the reply: shown again once due.
	const latest = conversation.messages.findLast((each) => !each.queued);
	const due = writing && latest?.role === "agent" ? replyDue(latest) : null;
	// A message still unanswered after a few seconds is shown as still sending.
	const slowAt = feed.nextSlow(id);
	useEffect(() => {
		if (slowAt === null) {
			return;
		}
		const timer = feed.timer.setTimeout(
			() => feed.recheck(),
			Duration.ms(slowAt - feed.wall.now()),
		);
		return () => timer.dispose();
	}, [slowAt, feed]);
	const [shown, show] = useState(0);
	useEffect(() => {
		const wait = due === null ? 0 : due - feed.wall.now();
		if (wait <= 0) {
			return;
		}
		const timer = feed.timer.setTimeout(
			() => show((times) => times + 1),
			Duration.ms(wait),
		);
		return () => timer.dispose();
	}, [due, feed]);
	const built = useMemo(() => {
		void shown;
		// Listing text omits work and thoughts, so it cannot anchor the initial history.
		if (conversation.summary) {
			return { all: [], last: undefined };
		}
		const now = feed.wall.now();
		const starting = conversation.status === "starting";
		// Held for a queued task, its agent waits for the task to start: what
		// it will be asked opens the thread, waiting as any prompt does for an
		// agent starting, with whatever the person said to it meanwhile after.
		const held = conversation.queued;
		const kept = conversation.messages.filter(
			(each) => !each.queued || starting || held !== null,
		);
		const said =
			held === null
				? kept
				: [heldPrompt(held, conversation.createdAt), ...kept];
		const happened = turnsOf(said, conversation.events);
		// An agent starting again may carry on the turn its last message holds.
		const resumed = starting
			? said.findLastIndex((each) => each.role === "agent")
			: -1;
		const liked = workingTimes(
			said.map((message, index) =>
				queuedReply(
					like(
						message,
						index,
						conversation.id,
						!writing || index < said.length - 1,
						said[index - 1]?.sentAt ?? said[index - 1]?.at ?? message.at,
						now,
						conversation.lastTask,
						happened[index],
						writing &&
							index === said.length - 1 &&
							conversation.ask?.type === "permission"
							? conversation.ask.at
							: null,
						said[index + 1]?.steered === true || index === resumed,
					),
					said[index - 1],
				),
			),
			said,
		);
		// The reply's place while the agent has yet to say anything, under the
		// id the reply will take: assistant-ui's own placeholder has an id of its
		// own, so the reply would mount afresh in its place and fade in again.
		// It holds the work row already, so the
		// agent's first move fills that row rather than putting one in its place.
		const prompt = said.at(-1);
		const thread =
			(running || starting || going || held !== null) && prompt?.role === "user"
				? [
						...liked,
						queuedReply(
							like(
								{
									role: "agent",
									parts: [],
									plan: null,
									at: null,
									until: null,
								},
								said.length,
								conversation.id,
								false,
								prompt.sentAt ?? prompt.at,
								now,
								null,
								happened[said.length],
							),
							prompt,
						),
					]
				: liked;
		// A running turn's queue sits above the composer. Otherwise it follows
		// the turn as sent, under a Queued row; held or starting, it is in `said`.
		const waiting =
			starting || held !== null || running
				? []
				: conversation.messages.filter((each) => each.queued);
		const ended = conversation.resting === true ? rested(thread) : thread;
		// Sent from the page, the server has yet to say when: queued since the
		// page sent it.
		const lastWaiting = waiting.at(-1);
		const pendingAt = (feed.sending.get(conversation.id) ?? []).findLast(
			(each) => each.queued,
		)?.at;
		const waitedOn =
			lastWaiting?.at === null && pendingAt !== undefined
				? { ...lastWaiting, at: new Date(pendingAt).toISOString() }
				: lastWaiting;
		const lined =
			waiting.length === 0
				? ended
				: [
						...ended,
						...waiting.map((message, at) =>
							like(message, ended.length + at, conversation.id),
						),
						queuedReply(
							like(
								{
									role: "agent",
									parts: [],
									plan: null,
									at: null,
									until: null,
								},
								ended.length + waiting.length,
								conversation.id,
							),
							waitedOn,
							// A message the page has yet to see recorded is still on its way.
							(status === "stopped" || status === "failed") &&
								lastWaiting?.at !== null
								? id
								: undefined,
						),
					];
		// What the server refused, after all of it, as it would go if sent again.
		const all = [
			...lined,
			...(unsent ?? []).map(({ message }, at) => {
				const one = like(messageOf(message), lined.length, conversation.id);
				return {
					...one,
					id: `unsent ${at}`,
					metadata: { custom: { ...one.metadata?.custom, unsent: at } },
				};
			}),
		];
		return { all, last: waiting.length === 0 ? all.at(-1) : ended.at(-1) };
	}, [
		conversation.summary,
		conversation.messages,
		conversation.status,
		conversation.queued,
		conversation.createdAt,
		conversation.ask,
		conversation.events,
		conversation.id,
		conversation.lastTask,
		conversation.resting,
		writing,
		running,
		going,
		shown,
		feed,
		unsent,
		status,
		id,
	]);
	const { all: messages, last } = built;
	// Its last word asks questions, escalates, or asks for a review, or it
	// asks as it works: the card takes the focus, not the composer, unless it
	// holds a draft. What is queued after it asks nothing.
	const asking =
		conversation.ask !== null ||
		(last?.role === "assistant" &&
			typeof last.content !== "string" &&
			last.content.some(
				(part) =>
					part.type === "data-questions" ||
					part.type === "data-review" ||
					(part.type === "data-event" &&
						isEscalation((part.data as { event: Event }).event)) ||
					(part.type === "data-report" &&
						(part.data as { report: TaskReport }).report.ending ===
							"escalated"),
			));
	const [first, setFirst] = useState<string | null>(
		() => messages[windowStart(messages, null)]?.id ?? null,
	);
	const start = windowStart(messages, first);
	useEffect(() => {
		if (first === null && messages.length > 0) {
			setFirst(messages[start]?.id ?? null);
		}
	}, [first, messages, start]);
	const loadEarlier = useCallback(async () => {
		setFirst(messages[windowStart(messages, first, 20)]?.id ?? null);
	}, [messages, first]);
	const visible = useMemo(() => messages.slice(start), [messages, start]);
	return {
		running,
		going,
		writing,
		queued,
		messages: visible,
		asking,
		hasEarlier: start > 0,
		loadEarlier,
	};
}

/** What `useThreadMessages` gives a thread. */
export interface ThreadMessages {
	hasEarlier: boolean;
	loadEarlier: () => Promise<void>;
	/** Whether the agent is at work, or a message is on its way to it. */
	running: boolean;
	/** Whether a message just sent holds the reply's place before the server says the agent works. */
	going: boolean;
	/** Whether the last message is still being written. */
	writing: boolean;
	/** What waits for the turn's end, above the composer while it runs. */
	queued: Message[];
	messages: ThreadMessageLike[];
	/** Whether a card asks the person something, to take the focus. */
	asking: boolean;
}

/** Start at a whole turn; once revealed, history stays mounted as new turns arrive. */
export function windowStart(
	messages: readonly ThreadMessageLike[],
	first: string | null,
	earlier = 0,
): number {
	const turns = messages.flatMap((message, index) =>
		index === 0 || (message.role === "user" && !carriesOn(message))
			? [index]
			: [],
	);
	let start = turns[Math.max(0, turns.length - 20)] ?? 0;
	const index = messages.findIndex((message) => message.id === first);
	if (index >= 0) {
		const turn = turns.findLast((at) => at <= index) ?? 0;
		start = Math.min(start, turn);
	}
	return turns[Math.max(0, turns.indexOf(start) - earlier)] ?? 0;
}

// Bound retained conversions across unmounts, while allowing superseded source
// messages to be collected as streaming replaces them.
const conversions = new Map<
	string,
	WeakMap<Message, { args: unknown[]; value: ThreadMessageLike }>
>();

/** Reuse a source message's conversion until a displayed input changes. */
export function like(...args: Parameters<typeof convert>): ThreadMessageLike {
	const [
		message,
		index,
		conversation,
		settled = true,
		began = message.at,
		now = Number.POSITIVE_INFINITY,
		task = null,
		events = [],
		waiting = null,
		cut = false,
	] = args;
	let cache = conversions.get(conversation);
	if (cache === undefined) {
		cache = new WeakMap();
	}
	conversions.delete(conversation);
	conversions.set(conversation, cache);
	if (conversions.size > 5) {
		const oldest = conversions.keys().next().value;
		if (oldest !== undefined) {
			conversions.delete(oldest);
		}
	}
	const inputs = [
		index,
		settled,
		began,
		settled ? null : now,
		task,
		waiting,
		cut,
		...events,
	];
	const previous = cache.get(message);
	if (
		previous !== undefined &&
		previous.args.length === inputs.length &&
		inputs.every((input, at) => input === previous.args[at])
	) {
		return previous.value;
	}
	const value = convert(...args);
	cache.set(message, { args: inputs, value });
	return value;
}

/**
 * A message as assistant-ui takes one, the one place ACP's shape meets
 * assistant-ui's. An agent's turn is what it said, a `data-work` part for
 * each run of work between, its reply the last thing it said, and a
 * `data-stopped` part when the person stopped it.
 */
function convert(
	message: Message,
	index: number,
	/** The conversation it is in, to read its images from. */
	conversation: string,
	settled = true,
	/** When the turn began: the person's prompt it answers. */
	began: string | null = message.at,
	/** The clock, as epoch ms, the latest words of a turn still going wait on. */
	now = Number.POSITIVE_INFINITY,
	/** The task it runs in, or last ran in, whose todos it can have added. */
	task: string | null = null,
	/** What splates did at the agent's word in this turn, oldest first. */
	events: readonly Event[] = [],
	waiting: string | null = null,
	/** Its turn went on past it, steered into or carried on by an agent coming back. */
	cut = false,
): ThreadMessageLike {
	const id = String(index);
	if (message.role === "user") {
		return {
			id,
			role: "user",
			content: message.parts.flatMap((part) =>
				part.type === "text"
					? [{ type: "text" as const, text: part.text }]
					: [],
			),
			// Shown as tiles above the words, each opening full size.
			attachments: message.parts
				.flatMap((part) =>
					part.type === "image" || part.type === "file" ? [part] : [],
				)
				.map((part, at) => attached(conversation, part, at)),
			// Marked as taken into the turn the agent was running or as said
			// into the mic, and stamped with when it was sent.
			metadata: {
				custom: {
					steered: message.steered ?? false,
					at: message.at,
					told: message.told ?? null,
					dictated: message.dictated ?? false,
					sending: message.sending ?? null,
				},
			},
		};
	}
	// Its work and the words it said along the way as one row, but for its
	// word that it added a task, then the last thing it said. Once the turn is
	// over, that is its reply, read for cards, even with tool calls after it.
	// A turn stopped or cut short is over, even before the server says so.
	const going =
		!settled &&
		message.stopped === undefined &&
		message.interrupted === undefined;
	const all = stretchesOf(
		message,
		began,
		going,
		now,
		events,
		waiting,
		cut || message.stopped !== undefined || message.interrupted !== undefined,
	);
	const reply = all.findLastIndex((stretch) => stretch.type === "said");
	return {
		id,
		role: "assistant",
		// Stamped with when it last moved, once it has stopped moving.
		metadata: {
			custom: {
				at: !going ? (message.until ?? message.at) : null,
			},
		},
		content: [
			...withEscalation(
				all.flatMap((stretch, at): LikePart[] =>
					stretch.type === "work"
						? [{ type: "data-work", data: { work: stretch.work } }]
						: stretch.type === "event"
							? [
									{
										type: "data-event",
										data: {
											event: stretch.event,
											also: stretch.also,
											going,
										},
									},
								]
							: stretch.type === "compaction"
								? [
										{
											type: "data-compaction",
											data: { compaction: stretch.compaction, going },
										},
									]
								: stretch.type === "background"
									? [
											{
												type: "data-background",
												data: { tool: stretch.tool },
											},
										]
									: at === reply
										? replied(stretch.text, !going, {
												task,
												began,
												until: message.until,
											})
										: [{ type: "text", text: stretch.text }],
				),
			),
			...(message.stopped === undefined
				? []
				: [{ type: "data-stopped" as const, data: { at: message.stopped } }]),
			...(message.interrupted === undefined
				? []
				: [
						{
							type: "data-interrupted" as const,
							data: { at: message.interrupted },
						},
					]),
		],
	};
}

/**
 * `thread` ended with a `data-rested` part on its last reply: a persistent
 * agent's run put away, its context closed, the next run to start afresh.
 */
function rested(thread: ThreadMessageLike[]): ThreadMessageLike[] {
	const last = thread.at(-1);
	if (last?.role !== "assistant" || typeof last.content === "string") {
		return thread;
	}
	return [
		...thread.slice(0, -1),
		{
			...last,
			content: [...last.content, { type: "data-rested", data: {} }],
		},
	];
}

/**
 * A file the person sent, as assistant-ui shows an attachment, keyed by `at`,
 * its place among the message's files: a file is named for what is in it, so
 * one sent twice in a message has one name, and assistant-ui throws on a key
 * it sees twice.
 */
function attached(
	conversation: string,
	part: Extract<Part, { type: "image" | "file" }>,
	at: number,
): NonNullable<ThreadMessageLike["attachments"]>[number] {
	const url = conversationAttachment(conversation, part);
	return {
		id: `${at}:${part.name}`,
		type: part.type,
		name: part.type === "file" ? part.title : part.name,
		contentType: part.mimeType,
		status: { type: "complete" },
		content:
			part.type === "image"
				? [{ type: "image", image: url }]
				: [
						{
							type: "file",
							data: url,
							mimeType: part.mimeType,
							filename: part.title,
							sourceType: "url",
						},
					],
	};
}
