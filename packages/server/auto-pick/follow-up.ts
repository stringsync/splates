import { type Message, textOf } from "../conversations";
import { DETAIL_CHARS } from "./classify";

/**
 * What to hand the judge after the person sends a message: null for their
 * first, which Auto pick judged as the conversation started, otherwise
 * everything they have said, the latest kept should it run long.
 */
export function wordsToJudge(
	messages: readonly Message[],
): { subject: string; detail: string } | null {
	const person = messages
		.filter((each) => each.role === "user" && each.told === undefined)
		.map(textOf)
		.filter((each) => !each.startsWith("[SPLATES"));
	return person.length < 2 ? null : split(person.join("\n\n"));
}

/**
 * What the judge reads of a conversation the person switched Auto pick on
 * for: everything they have said in `messages`, the latest kept should it
 * run long; null before they have said anything.
 */
export function wordsSoFar(
	messages: readonly Message[],
): { subject: string; detail: string } | null {
	const person = messages
		.filter((each) => each.role === "user" && each.told === undefined)
		.map(textOf)
		.filter((each) => !each.startsWith("[SPLATES"));
	const words = person.join("\n\n").trim();
	return words === "" ? null : split(words);
}

/** `words` as the judge reads them: the first line as the subject, the last of the rest as detail. */
function split(words: string): { subject: string; detail: string } {
	const [first = "", ...rest] = words.trim().split("\n");
	return {
		subject: first.trim(),
		detail: rest.join("\n").trim().slice(-DETAIL_CHARS),
	};
}

/**
 * Whether the person's second message, among `said`, answers a first agent
 * reply that ended on a bare prose question rather than a card, however the
 * conversation began.
 */
export function askedBack(
	messages: readonly Message[],
	said: readonly Message[],
): boolean {
	const prompts = messages.flatMap((each, at) =>
		each.role === "user" ? [at] : [],
	);
	const [first, answer] = prompts;
	const reply = answer === undefined ? undefined : messages[answer];
	if (
		first === undefined ||
		reply === undefined ||
		reply.told !== undefined ||
		!said.includes(reply)
	) {
		return false;
	}
	return messages
		.slice(first, answer)
		.filter((each) => each.role === "agent")
		.map(textOf)
		.join("")
		.trim()
		.endsWith("?");
}
