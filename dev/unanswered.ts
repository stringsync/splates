import { answerIn, stretches } from "../asked";
import type { Message } from "../conversations";
import type { Question } from "../plan";

/**
 * The line a reply from the open questions' dialog opens with: its numbers are those of
 * `## Blocked`, not of the agent's latest report, as the arbor skill reads it.
 */
export const BLOCKED_REPLY = "Answers to `## Blocked`, by its numbers there:";

/** `lines` as that dialog's card sends them, headed so the agent reads them right. */
export function blockedReply(lines: string): string {
	return `${BLOCKED_REPLY}\n${lines}`;
}

/**
 * Of `open`, a task's open questions in `## Blocked`, those no reply in
 * `messages` has answered yet, and of them, those no card lets the person
 * answer: what the page asks in a dialog of its own. A question is on a card
 * while the thread ends on the agent's message asking it, and answered once a
 * reply to a card asking it, or from their dialog, says so, until the
 * agent records the answer.
 */
export function unanswered(
	open: Question[],
	messages: Message[],
	/** Whether the agent is still writing its last message. */
	running: boolean,
): { unanswered: Question[]; uncarded: Question[] } {
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
	const last = messages.at(-1);
	const carded = last?.role === "agent" && !running ? asks(last) : [];
	const left = open.filter((asked) => !done.has(asked));
	return {
		unanswered: left,
		uncarded: left.filter(
			(asked) => !carded.some((card) => alike(asked, card)),
		),
	};
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
