/**
 * `text` with `words` added after it, under a line saying the person wrote
 * them at `at` (milliseconds since the epoch) while the task was queued, so
 * the agent that takes it knows what came after the first ask.
 */
export function addedWhileQueued(
	text: string,
	words: string,
	at: number,
): string {
	const when = new Intl.DateTimeFormat(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(at);
	const note = `**Added while queued, ${when}:**\n\n${words}`;
	return text.trim() === "" ? note : `${text}\n\n${note}`;
}
