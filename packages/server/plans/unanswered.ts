import type { Message } from "../conversations";
import { stretches } from "./asked";
import type { Needing } from "./needs";
import type { Question } from "./plan";
import { answerIn, quotedIn } from "./reply";

/**
 * Of `open`, a task's open questions, returns those the person has not yet
 * answered in `messages`, to tell a conversation still asking from one whose
 * answers the agent has yet to record.
 */
export function unanswered(open: Question[], messages: Message[]): Question[] {
	// A question is answered once a reply quotes it with an answer, or a reply
	// to a card asking it answers its number.
	const done = new Set<Question>();
	messages.forEach((message, at) => {
		if (message.role !== "user") {
			return;
		}
		const text = textOf(message);
		const before = messages[at - 1];
		for (const asked of open) {
			if (quotedIn(text, asked) !== null) {
				done.add(asked);
			}
		}
		if (before?.role === "agent") {
			for (const card of asks(before)) {
				const same = open.find((asked) => alike(asked, card));
				if (same !== undefined && answerIn(text, card) !== null) {
					done.add(same);
				}
			}
		}
	});
	return open.filter((asked) => !done.has(asked));
}

/** The questions an agent's message asks as cards, in its last words. */
function asks(message: Message): Question[] {
	const said = message.parts.findLast(
		(part) => part.type === "text" && part.text.trim() !== "",
	);
	if (said?.type !== "text") {
		return [];
	}
	return stretches(said.text).flatMap((stretch) =>
		stretch.type === "questions" ? stretch.questions : [],
	);
}

function textOf(message: Message): string {
	return message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

/** The same question, in a report and in `## Blocked`: its line, give or take spacing and case. */
function alike(one: Question, other: Question): boolean {
	const plain = (text: string) =>
		text.replace(/\s+/g, " ").trim().toLowerCase();
	return plain(one.text) === plain(other.text);
}

/**
 * Tells whether `row` waits on you, for ⌥⌘M, Needs you and the waiting counts
 * to stop on: true while its conversation has stopped on you with questions
 * no reply has answered yet.
 */
export function waitsOnYou({ conversation, need }: Needing): boolean {
	// An agent outside the page never does, as it asks in its own session.
	// One the page runs asks as it works only in its plan, until its report
	// asks again as it stops. A subagent of one here waits through that one.
	if (conversation === null) {
		return false;
	}
	if (need.kind === "waiting" && need.why !== "questions") {
		return true;
	}
	if (
		need.kind === "idle" ||
		need.kind === "working" ||
		need.kind === "assuming"
	) {
		return false;
	}
	return unanswered(need.questions, conversation.messages).length > 0;
}
