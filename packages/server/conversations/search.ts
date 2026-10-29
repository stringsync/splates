import type { ConversationState } from "./state";

/**
 * What a conversation's words hold of a search: a line around the first
 * place each word is found in them, by the word. Words it lacks are left out.
 */
export type Said = Record<string, string>;

/** The words a search of `query` matches, each lowercase, every one needed. */
export function wordsOf(query: string): string[] {
	return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * What `state`'s messages say of `words`, for ⌘K to match where a listing's
 * summary has left the words out; null when they say none of them.
 */
export function saidIn(state: ConversationState, words: string[]): Said | null {
	const body = state.messages
		.flatMap((message) =>
			message.parts.flatMap((part) =>
				part.type === "text" ? [part.text] : [],
			),
		)
		.join("\n");
	const lower = body.toLowerCase();
	const said: Said = {};
	for (const word of words) {
		const at = lower.indexOf(word);
		if (at !== -1) {
			said[word] = snippetOf(body, at, word.length);
		}
	}
	return Object.keys(said).length === 0 ? null : said;
}

/** One line of `body` around `length` characters at `at`. */
export function snippetOf(body: string, at: number, length: number): string {
	const from = Math.max(0, at - AROUND);
	const to = Math.min(body.length, at + length + AROUND);
	const line = body.slice(from, to).replace(/\s+/g, " ").trim();
	return `${from > 0 ? "…" : ""}${line}${to < body.length ? "…" : ""}`;
}

/** How much of a body a snippet shows either side of the words. */
const AROUND = 40;
