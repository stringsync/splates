import type { ThreadMessageLike } from "@assistant-ui/react";
import { useEffect, useMemo, useState } from "react";
import { Duration } from "webappwiz/time";
import {
	type Report,
	type Review,
	type Stretch,
	stretches,
	type TaskReport,
} from "../asked";
import type { ConversationState, Message, Part } from "../conversations";
import { type Event, isEscalation } from "../events";
import { conversationAttachment } from "./conversation-api";
import { type ConversationFeed, messageOf } from "./conversation-feed";
import type { Written } from "./escalation-card";
import type { QuestionsData } from "./message-questions";
import type { Turn } from "./report-cards";
import { replyDue, stretchesOf } from "./work";
import { workingTimes } from "./working-report-time";

/** One part of a message as assistant-ui takes it. */
type LikePart = Exclude<ThreadMessageLike["content"], string>[number];

/**
 * What a conversation's thread shows: its messages as assistant-ui takes
 * them, with the reply's place held while the agent has yet to speak, and
 * what waits for the turn's end apart, for above the composer.
 */
export function useThreadMessages(
	conversation: ConversationState,
	feed: ConversationFeed,
): ThreadMessages {
	const { id, status } = conversation;
	// Only once the server says the agent works: a message still on its way
	// has not woken it, or reached a turn it is in.
	const running = status === "running";
	const unsent = feed.unsent.get(id);
	// The last message is still being written while the agent works. An agent
	// starting is coming back to answer a prompt, never to go on with the turn
	// it last ended, which a lost connection may have cut short.
	const writing = status === "running";
	// What waits for the turn's end sits above the composer, not in the
	// thread: the agent has yet to hear it, and the thread would take it for
	// a turn the agent is answering.
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
	const messages = useMemo(() => {
		void shown;
		const now = feed.wall.now();
		const said = conversation.messages.filter((each) => !each.queued);
		const happened = turnsOf(said, conversation.events);
		const liked = workingTimes(
			said.map((message, index) =>
				like(
					message,
					index,
					conversation.id,
					!writing || index < said.length - 1,
					said[index - 1]?.at ?? message.at,
					now,
					conversation.lastTask,
					happened[index],
					writing &&
						index === said.length - 1 &&
						conversation.ask?.type === "permission"
						? conversation.ask.at
						: null,
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
			running && prompt?.role === "user"
				? [
						...liked,
						like(
							{ role: "agent", parts: [], plan: null, at: null, until: null },
							said.length,
							conversation.id,
							false,
							prompt.at,
							now,
							null,
							happened[said.length],
						),
					]
				: liked;
		// What the server refused, after all of it, as it would go if sent again.
		return [
			...thread,
			...(unsent ?? []).map(({ message }, at) => {
				const one = like(messageOf(message), thread.length, conversation.id);
				return {
					...one,
					id: `unsent ${at}`,
					metadata: { custom: { ...one.metadata?.custom, unsent: at } },
				};
			}),
		];
	}, [
		conversation.messages,
		conversation.ask,
		conversation.events,
		conversation.id,
		conversation.lastTask,
		writing,
		running,
		shown,
		feed,
		unsent,
	]);
	// Where the person left off, as it opens: the first message they have yet
	// to see, read on from there, else the bottom. Opening marks it read, so
	// this holds what it was before.
	const [openAt] = useState(() =>
		conversation.unread ? String(conversation.seen) : undefined,
	);
	// Its last word asks questions, escalates, or asks for a review, or it
	// asks as it works: the card takes the focus, not the composer, unless it
	// holds a draft.
	const last = messages.at(-1);
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
						(part.data as { report: Report }).report.ending === "escalated"),
			));
	return { running, writing, queued, messages, openAt, asking };
}

/** What `useThreadMessages` gives a thread. */
export interface ThreadMessages {
	/** Whether the agent is at work, or a message is on its way to it. */
	running: boolean;
	/** Whether the last message is still being written. */
	writing: boolean;
	/** What waits for the turn's end, shown above the composer. */
	queued: Message[];
	messages: ThreadMessageLike[];
	/** The message to open at, the first unseen, or undefined for the bottom. */
	openAt: string | undefined;
	/** Whether a card asks the person something, to take the focus. */
	asking: boolean;
}

/**
 * A message as assistant-ui takes one, the one place ACP's shape meets
 * assistant-ui's. An agent's turn is what it said, a `data-work` part for
 * each run of work between, its reply the last thing it said, and a
 * `data-stopped` part when the person stopped it.
 */
export function like(
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
	/** What arbor did at the agent's word in this turn, oldest first. */
	events: readonly Event[] = [],
	waiting: string | null = null,
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
					sending: message.sending ?? false,
				},
			},
		};
	}
	// Its work and the words it said along the way as one row, but for its
	// word that it added a task, then the last thing it said. Once the turn is
	// over, that is its reply, read for cards, even with tool calls after it.
	const all = stretchesOf(message, began, !settled, now, events, waiting);
	const reply = all.findLastIndex((stretch) => stretch.type === "said");
	return {
		id,
		role: "assistant",
		// Stamped with when it last moved, once it has stopped moving.
		metadata: {
			custom: { at: settled ? (message.until ?? message.at) : null },
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
											going: !settled,
										},
									},
								]
							: stretch.type === "compaction"
								? [
										{
											type: "data-compaction",
											data: { compaction: stretch.compaction },
										},
									]
								: stretch.type === "added"
									? stretches(stretch.text).flatMap((each): LikePart[] =>
											each.type === "start"
												? [{ type: "data-start", data: { start: each.start } }]
												: each.type === "text"
													? [{ type: "text", text: each.text }]
													: [],
										)
									: at === reply
										? replied(stretch.text, settled, {
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
 * `parts` with what the agent wrote of the last escalation arbor recorded in
 * them, its report, the questions it ends with and their demo, its review,
 * or the proposal it escalated to wait on, taken into the escalation's card
 * rather than drawn as a second one.
 */
function withEscalation(parts: LikePart[]): LikePart[] {
	const escalatedIn = (part: LikePart): { event: Event } | null => {
		if (part.type !== "data-event") {
			return null;
		}
		const data = part.data as { event: Event };
		return isEscalation(data.event) ? data : null;
	};
	const at = parts.findLastIndex((part) => escalatedIn(part) !== null);
	const data = at === -1 ? null : escalatedIn(parts[at] as LikePart);
	if (data === null) {
		return parts;
	}
	const { event } = data;
	const written: Written = {
		report: null,
		demo: null,
		assumed: [],
		review: null,
		proposal: null,
		questions: [],
	};
	const kept = parts.filter((part, index) => {
		if (index === at) {
			return true;
		}
		if (part.type === "data-report") {
			const { report } = part.data as { report: Report };
			if (
				report.ending === "escalated" &&
				"task" in report &&
				report.task === event.task
			) {
				written.report = report;
				return false;
			}
		}
		if (part.type === "data-questions") {
			const { questions, escalation, proposal, demo, assumed, task } =
				part.data as QuestionsData;
			if (escalation?.task === event.task) {
				written.report = escalation;
				written.demo = demo;
				written.assumed = assumed;
				return false;
			}
			// A proposal names no task of its own: the turn's is the escalation's,
			// where the log can say it at all.
			if (proposal !== null && (task === null || task === event.task)) {
				written.proposal = proposal;
				written.questions = questions;
				written.demo = demo;
				written.assumed = assumed;
				return false;
			}
		}
		if (part.type === "data-review") {
			const { review } = part.data as { review: Review };
			if (review.task === event.task) {
				written.review = review;
				return false;
			}
		}
		return true;
	});
	return kept.map((part) =>
		part === parts[at]
			? {
					type: "data-event" as const,
					data: { ...data, written },
				}
			: part,
	);
}

/**
 * Each event by the index of the agent's turn it came in: the turn going at
 * the time, or the one answering a prompt it followed, which the reply's
 * place holds until the agent speaks. Each turn's events stay oldest first.
 */
function turnsOf(
	said: Message[],
	events: readonly Event[],
): Record<number, Event[]> {
	const turns: Record<number, Event[]> = {};
	for (const event of events) {
		const last = said.findLastIndex(
			(message) => message.at !== null && message.at <= event.at,
		);
		const turn = said[last]?.role === "agent" ? last : last + 1;
		turns[turn] = [...(turns[turn] ?? []), event];
	}
	return turns;
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

/** The escalation `stretch` reports; null for any other stretch. */
function escalatedIn(stretch: Stretch | undefined): TaskReport | null {
	return stretch?.type === "report" && stretch.report.ending === "escalated"
		? stretch.report
		: null;
}

/**
 * The agent's reply, its questions and review as cards once it has stopped
 * writing them: a list mid-stream may yet turn out not to ask any. An
 * escalation's questions come right after it, or after the calls it assumed
 * and the demo they ask about, so they are one card: the questions, headed
 * as the escalation, the demo above them, the calls assumed among them. A run of todos is one part, with `turn` to say which
 * of them it added, and `next` whether it follows a merge or remove report.
 */
function replied(text: string, settled: boolean, turn: Turn): LikePart[] {
	if (!settled) {
		return [{ type: "text", text }];
	}
	const all = stretches(text);
	return all.flatMap((stretch, at): LikePart[] => {
		const before = all[at - 1];
		const after = all[at + 1];
		// How many stretches from `from`, going by `step`, stand between
		// questions and what heads them: the calls assumed and the demo.
		const aside = (from: number, step: 1 | -1): number => {
			let count = 0;
			while (
				["assumed", "demo"].includes(all[from + count * step]?.type ?? "")
			) {
				count += 1;
			}
			return count;
		};
		// The questions an escalation or proposal ends, past what stands between.
		const asking = all[at + 1 + aside(at + 1, 1)];
		switch (stretch.type) {
			case "text":
				return [{ type: "text", text: stretch.text }];
			case "questions": {
				const demo = before?.type === "demo" ? before.demo : null;
				const said = all[demo === null ? at - 1 : at - 2];
				const assumed = said?.type === "assumed" ? said.assumed : [];
				const heading = all[at - 1 - aside(at - 1, -1)];
				return [
					{
						type: "data-questions",
						data: {
							questions: stretch.questions,
							escalation: escalatedIn(heading),
							proposal: heading?.type === "proposal" ? heading.proposal : null,
							demo,
							assumed,
							task: turn.task,
						} satisfies QuestionsData,
					},
				];
			}
			case "assumed":
				// Before questions, they are the questions' card; else one of
				// their own, headed as an escalation they end.
				return asking?.type === "questions"
					? []
					: [
							{
								type: "data-questions",
								data: {
									questions: [],
									escalation: escalatedIn(before),
									proposal: null,
									demo: null,
									assumed: stretch.assumed,
									task: turn.task,
								} satisfies QuestionsData,
							},
						];
			case "demo":
				return after?.type === "questions" || before?.type === "proposal"
					? []
					: [{ type: "data-demo", data: { demo: stretch.demo } }];
			case "review":
				return [{ type: "data-review", data: { review: stretch.review } }];
			case "proposal":
				// Its questions are its card; without any, it is a card of its own.
				return asking?.type === "questions"
					? []
					: [
							{
								type: "data-questions",
								data: {
									questions: [],
									escalation: null,
									proposal: stretch.proposal,
									demo: after?.type === "demo" ? after.demo : null,
									assumed: [],
									task: turn.task,
								} satisfies QuestionsData,
							},
						];
			case "start":
				return [{ type: "data-start", data: { start: stretch.start } }];
			case "report":
				return stretch.report.ending === "escalated" &&
					(asking?.type === "questions" || after?.type === "assumed")
					? []
					: [{ type: "data-report", data: { report: stretch.report } }];
			case "todo": {
				// A run of todos is one part, to gather those added to a lane.
				if (before?.type === "todo") {
					return [];
				}
				const run = all.slice(at);
				const end = run.findIndex((each) => each.type !== "todo");
				const todos = (end === -1 ? run : run.slice(0, end)).flatMap((each) =>
					each.type === "todo" ? [each.todo] : [],
				);
				// Those right after a task ended, or lanes finished, are what to
				// take up next.
				const next =
					before?.type === "report" &&
					before.report.ending !== "escalated" &&
					before.report.ending !== "waiting" &&
					before.report.ending !== "working";
				return [{ type: "data-todo", data: { todos, turn, next } }];
			}
			default:
				return stretch satisfies never;
		}
	});
}
