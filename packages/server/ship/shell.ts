/** `word` as one shell word. */
export function quoted(word: string): string {
	return /^[\w@/.=:+-]+$/.test(word)
		? word
		: `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The last few lines of what a command said, for an error naming it. */
export function lastLines(text: string): string {
	return text.trim().split("\n").slice(-5).join("\n");
}
