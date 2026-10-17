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
