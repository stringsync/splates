import { type Message, textOf } from "../conversations";
import { DETAIL_CHARS } from "./classify";

/**
 * How long a message must be for the judge to read it. Shorter ones, such as
 * "go" or "retry", never widened the work in the conversations looked at.
 */
export const READ_CHARS = 40;

/**
 * From the person's message this many on, the judge reads every one, with all
 * they said before it, however short: a conversation that runs on is often
 * bigger than its first message said.
 */
export const LONG = 4;

/**
 * What the judge reads of `said`, the person's next messages: nothing for
 * the conversation's first, which Auto pick judged as it started, or for
 * words under {@link READ_CHARS}; from their {@link LONG}th message on,
 * everything they have said, the latest kept should it run long.
 */
export function wordsToJudge(
	messages: readonly Message[],
	said: readonly Message[],
): { subject: string; detail: string } | null {
	const person = messages
		.filter((each) => each.role === "user" && each.told === undefined)
		.map(textOf)
		.filter((each) => !each.startsWith("[SPLATES"));
	if (person.length < 2) {
		return null;
	}
	const latest = said
		.map(textOf)
		.filter((each) => !each.startsWith("[SPLATES"))
		.join("\n\n")
		.trim();
	if (person.length >= LONG) {
		return split(person.join("\n\n"));
	}
	return latest.length < READ_CHARS ? null : split(latest);
}

/** `words` as the judge reads them: the first line as the subject, the last of the rest as detail. */
function split(words: string): { subject: string; detail: string } {
	const [first = "", ...rest] = words.trim().split("\n");
	return {
		subject: first.trim(),
		detail: rest.join("\n").trim().slice(-DETAIL_CHARS),
	};
}
