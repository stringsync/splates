import type { Message } from "@stringsync/splates-server/conversations";
import type { Event } from "@stringsync/splates-server/records";

/**
 * What splates did at the agent's word, by the reply it came in: each of
 * `events` goes to the turn of the last message said by the time it was
 * recorded.
 */
export function turnsOf(
	said: readonly Message[],
	events: readonly Event[],
): Record<number, Event[]> {
	const turns: Record<number, Event[]> = {};
	for (const event of events) {
		const last = said.findLastIndex(
			(message) => message.at !== null && message.at <= event.at,
		);
		// Before anything was said, as Auto's pick is, it goes with the reply
		// to the first prompt, which it was made for.
		const turn =
			said[last]?.role === "agent"
				? last
				: last === -1 && said[0]?.role === "user"
					? 1
					: last + 1;
		turns[turn] = [...(turns[turn] ?? []), event];
	}
	return turns;
}
