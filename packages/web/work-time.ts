import { Duration } from "webappwiz/time";
import { span, type Work } from "./work";

/** Elapsed work excludes permission waits, including overlapping requests. */
export function workingSpan(work: Work, now: string | number): string {
	const start = Date.parse(work.at ?? "");
	const end = typeof now === "number" ? now : Date.parse(now);
	let paused = 0;
	let through = start;
	const waits = (work.waits ?? [])
		.map((wait) => ({
			from: Math.max(start, Date.parse(wait.from)),
			to: Math.min(end, wait.to === null ? end : Date.parse(wait.to)),
		}))
		.sort((left, right) => left.from - right.from);
	for (const wait of waits) {
		paused += Math.max(0, wait.to - Math.max(through, wait.from));
		through = Math.max(through, wait.to);
	}
	return span(work.at ?? "", end - paused);
}

/** Elapsed live work, frozen after thirty seconds without an agent update. */
export function liveWorkingSpan(work: Work, now: number): string {
	const latest = Date.parse(work.activityAt ?? work.until ?? work.at ?? "");
	return workingSpan(
		work,
		Number.isFinite(latest)
			? Math.min(now, latest + Duration.secs(30).ms)
			: now,
	);
}

/** How long a live agent has been silent; permission waits and finished work are exempt. */
export function workSilence(
	work: Work,
	now: number,
): { text: string; stuck: boolean } | null {
	if (!work.working || work.waits?.some((wait) => wait.to === null)) {
		return null;
	}
	const latest = work.activityAt ?? work.until ?? work.at;
	const elapsed = now - Date.parse(latest ?? "");
	if (!Number.isFinite(elapsed) || elapsed < Duration.secs(30).ms) {
		return null;
	}
	return {
		text: `No activity for ${span(latest ?? "", now)}`,
		stuck: elapsed >= Duration.mins(2).ms,
	};
}
