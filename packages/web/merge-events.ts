import type { Event } from "@stringsync/splates-server/records";

/** Ids of the first step of each task's newest merge: a merge queued, or a start that no queue preceded. */
export function newestMerges(events: readonly Event[]): Set<string> {
	const latest = new Map<string, Event>();
	for (const event of events) {
		const first =
			event.action === "merge queued" ||
			(event.action === "merge start" && event.began == null);
		if (first && event.task !== null) {
			const was = latest.get(event.task);
			if (was === undefined || event.at >= was.at) {
				latest.set(event.task, event);
			}
		}
	}
	return new Set([...latest.values()].map((event) => event.id));
}

/** Ids of the refused merges that a later merge attempt for the same task followed. */
export function supersededMerges(events: readonly Event[]): Set<string> {
	const out = new Set<string>();
	for (const event of events) {
		if (event.action === "merge" && event.reason !== null) {
			const later = events.some(
				(each) =>
					each.at > event.at &&
					each.task === event.task &&
					(each.action === "merge" ||
						each.action === "merge queued" ||
						each.action === "merge start"),
			);
			if (later) {
				out.add(event.id);
			}
		}
	}
	return out;
}
