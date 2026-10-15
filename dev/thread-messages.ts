import type { ThreadMessageLike } from "@assistant-ui/react";
import { useEffect, useMemo, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { type Report, stretches } from "../asked";
import type { ConversationState, Message, Part } from "../conversations";
import { conversationAttachment } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import type { Turn } from "./report-cards";
import { replyDue, stretchesOf } from "./work";

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
	const running = status === "running" || feed.sending.has(id);
	// The last message is still being written while the agent works.
	const writing = status === "running" || status === "starting";
	// What waits for the turn's end sits above the composer, not in the
	// thread: the agent has yet to hear it, and the thread would take it for
	// a turn the agent is answering.
	const queued = conversation.messages.filter((each) => each.queued);
	// The latest words wait a moment to show as the reply: shown again once due.
	const latest = conversation.messages.findLast((each) => !each.queued);
	const due = writing && latest?.role === "agent" ? replyDue(latest) : null;
	const [shown, show] = useState(0);
	useEffect(() => {
		const wait = due === null ? 0 : due - Date.now();
		if (wait <= 0) {
			return;
		}
		const timer = new SystemTimer().setTimeout(
			() => show((times) => times + 1),
			Duration.ms(wait),
		);
		return () => timer.dispose();
	}, [due]);
	const messages = useMemo(() => {
		void shown;
		const now = Date.now();
		const said = conversation.messages.filter((each) => !each.queued);
		const liked = said.map((message, index) =>
			like(
				message,
				index,
				conversation.id,
				!writing || index < said.length - 1,
				said[index - 1]?.at ?? message.at,
				now,
				conversation.lastTask,
			),
		);
		// The reply's place while the agent has yet to say anything, under the
		// id the reply will take: assistant-ui's own placeholder has an id of its
		// own, so the reply would mount afresh in its place and fade in again.
		// It holds the work row already, so the
		// agent's first move fills that row rather than putting one in its place.
		const prompt = said.at(-1);
		return running && prompt?.role === "user"
			? [
					...liked,
					like(
						{ role: "agent", parts: [], plan: null, at: null, until: null },
						said.length,
						conversation.id,
						false,
						prompt.at,
						now,
					),
				]
			: liked;
	}, [
		conversation.messages,
		conversation.id,
		conversation.lastTask,
		writing,
		running,
		shown,
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
			attachments: message.parts.flatMap((part) =>
				part.type === "image" || part.type === "file"
					? [attached(conversation, part)]
					: [],
			),
			// Marked as taken into the turn the agent was running, and stamped
			// with when it was sent.
			metadata: {
				custom: { steered: message.steered ?? false, at: message.at },
			},
		};
	}
	// Its work and the words it said along the way as one row, but for its
	// word that it added a task, then the last thing it said. Once the turn is
	// over, that is its reply, read for cards, even with tool calls after it.
	const all = stretchesOf(message, began, !settled, now);
	const reply = all.findLastIndex((stretch) => stretch.type === "said");
	return {
		id,
		role: "assistant",
		// Stamped with when it last moved, once it has stopped moving.
		metadata: {
			custom: { at: settled ? (message.until ?? message.at) : null },
		},
		content: [
			...all.flatMap((stretch, at): LikePart[] =>
				stretch.type === "work"
					? [{ type: "data-work", data: { work: stretch.work } }]
					: stretch.type === "added"
						? stretches(stretch.text).flatMap((each): LikePart[] =>
								each.type === "start"
									? [{ type: "data-start", data: { start: each.start } }]
									: each.type === "cred"
										? [{ type: "data-cred", data: { name: each.name } }]
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

/** A file the person sent, as assistant-ui shows an attachment. */
function attached(
	conversation: string,
	part: Extract<Part, { type: "image" | "file" }>,
): NonNullable<ThreadMessageLike["attachments"]>[number] {
	const url = conversationAttachment(conversation, part);
	return {
		id: part.name,
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

/**
 * The agent's reply, its questions and review as cards once it has stopped
 * writing them: a list mid-stream may yet turn out not to ask any. An
 * escalation's questions come right after it, or after the demo they ask
 * about, so they are one card: the questions, headed as the escalation, the
 * demo above them. A run of todos is one part, with `turn` to say which
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
		// The questions an escalation ends, past the demo between them.
		const asking = after?.type === "demo" ? all[at + 2] : after;
		switch (stretch.type) {
			case "text":
				return [{ type: "text", text: stretch.text }];
			case "questions": {
				const demo = before?.type === "demo" ? before.demo : null;
				const heading = demo === null ? before : all[at - 2];
				return [
					{
						type: "data-questions",
						data: {
							questions: stretch.questions,
							escalation:
								heading?.type === "report" &&
								heading.report.ending === "escalated"
									? heading.report
									: null,
							demo,
						},
					},
				];
			}
			case "demo":
				return after?.type === "questions"
					? []
					: [{ type: "data-demo", data: { demo: stretch.demo } }];
			case "review":
				return [{ type: "data-review", data: { review: stretch.review } }];
			case "start":
				return [{ type: "data-start", data: { start: stretch.start } }];
			case "cred":
				return [{ type: "data-cred", data: { name: stretch.name } }];
			case "report":
				return stretch.report.ending === "escalated" &&
					asking?.type === "questions"
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
