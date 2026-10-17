import { stretches } from "../asked";
import type { Message } from "../conversations";
import type { Question } from "../plan";
import { answerIn, quotedIn } from "../reply";

/**
 * Of `open`, a task's open questions in `## Blocked`, those no reply in
 * `messages` has answered yet. A question is answered once a reply quotes it
 * with an answer, or a reply to a card asking it answers its number, until the
 * agent records the answer.
 */
export function unanswered(open: Question[], messages: Message[]): Question[] {
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
