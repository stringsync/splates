import { answerIn, stretches } from "../asked";
import type { Message } from "../conversations";
import type { Question } from "../plan";

/**
 * How a reply to the questions in `## Blocked` opens, as their cards outside
 * a conversation copy it: its numbers are those of `## Blocked`, not of the
 * agent's latest report, as the arbor skill reads it.
 */
export const BLOCKED_REPLY = "Answers to `## Blocked`, by its numbers there";

/**
 * `lines` as those cards copy them, headed so the agent reads them
 * right: answered ahead of its report, from `ARBOR.md` as the page last read
 * it, so a question the agent changed or added since may be answered stale or
 * not at all.
 */
export function blockedReply(lines: string): string {
	return `${BLOCKED_REPLY}, answered ahead of your report from \`ARBOR.md\` as the page last read it: a question you changed since may have a stale answer, and one you added none.\n${lines}`;
}

/**
 * Of `open`, a task's open questions in `## Blocked`, those no reply in
 * `messages` has answered yet. A question is answered once a reply to a card
 * asking it, or by the numbers in `## Blocked`, says so, until the agent
 * records the answer.
 */
export function unanswered(open: Question[], messages: Message[]): Question[] {
	const done = new Set<Question>();
	messages.forEach((message, at) => {
		if (message.role !== "user") {
			return;
		}
		const text = textOf(message);
		const before = messages[at - 1];
		if (text.startsWith(BLOCKED_REPLY)) {
			for (const asked of open) {
				if (answerIn(text, asked) !== null) {
					done.add(asked);
				}
			}
		} else if (before?.role === "agent") {
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
