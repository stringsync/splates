import type { ThreadMessageLike } from "@assistant-ui/react";
import { stretches } from "../asked";
import type { Message, Part } from "../conversations";
import { conversationAttachment } from "./api";
import type { Turn } from "./report-cards";
import { stretchesOf } from "./work";

/** One part of a message as assistant-ui takes it. */
type LikePart = Exclude<ThreadMessageLike["content"], string>[number];

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
			// Marked as taken into the turn the agent was running.
			metadata: { custom: { steered: message.steered ?? false } },
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
		content: [
			...all.flatMap((stretch, at): LikePart[] =>
				stretch.type === "work"
					? [{ type: "data-work", data: { work: stretch.work } }]
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
			...(message.stopped === undefined
				? []
				: [{ type: "data-stopped" as const, data: { at: message.stopped } }]),
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
				// Those right after a task ended are what to take up next.
				const next =
					before?.type === "report" && before.report.ending !== "escalated";
				return [{ type: "data-todo", data: { todos, turn, next } }];
			}
			default:
				return stretch satisfies never;
		}
	});
}
