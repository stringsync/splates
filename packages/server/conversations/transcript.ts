import type { Message } from "./state";

/** How much of the end of a conversation a transcript keeps, in characters. */
export const TRANSCRIPT_CHARS = 40_000;

/**
 * The end of what was said and done in `messages`, as markdown for the next
 * agent on its task to read: each turn's words, and a line for each command
 * or other tool its agent ran, with how it ended. Thoughts and files stay out.
 */
export function transcriptOf(messages: readonly Message[]): string {
	const turns = messages.map((message) => {
		const lines = message.parts.flatMap((part) => {
			switch (part.type) {
				case "text":
					return [part.text.trim()];
				case "tool":
					return [`- ${part.command ?? part.title} (${part.status})`];
				default:
					return [];
			}
		});
		const said = lines.filter((each) => each !== "").join("\n\n");
		return said === ""
			? ""
			: `## ${message.role === "user" ? "Person" : "Agent"}\n\n${said}`;
	});
	const text = turns.filter((each) => each !== "").join("\n\n");
	return text.length <= TRANSCRIPT_CHARS
		? text
		: `…\n\n${text.slice(text.length - TRANSCRIPT_CHARS)}`;
}
