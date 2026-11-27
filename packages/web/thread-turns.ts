import type { Message } from "@splates/server/conversations";
import type { Event } from "@splates/server/records";

/**
 * What splates did at the agent's word, by the reply it came in: each of
 * `events` goes to the turn of the last message said by the time it was
 * recorded, except continuation and finish events (`began`), which stay in the
 * turn of the event they began with so a backgrounded command folds back into
 * its original card even when it finishes in a later turn.
 */
export function turnsOf(
	said: readonly Message[],
	events: readonly Event[],
): Record<number, Event[]> {
	const turns: Record<number, Event[]> = {};
	const byId = new Map<string, number>();
	for (const event of events) {
		const began = "began" in event ? event.began : null;
		const inherited = began == null ? undefined : byId.get(began);
		const turn =
			inherited !== undefined
				? inherited
				: (() => {
						const last = said.findLastIndex(
							(message) => message.at !== null && message.at <= event.at,
						);
						// Before anything was said, as Auto's pick is, it goes with the reply
						// to the first prompt, which it was made for.
						return said[last]?.role === "agent"
							? last
							: last === -1 && said[0]?.role === "user"
								? 1
								: last + 1;
					})();
		byId.set(event.id, turn);
		turns[turn] = [...(turns[turn] ?? []), event];
	}
	return turns;
}
