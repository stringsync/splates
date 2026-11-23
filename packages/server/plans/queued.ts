/** One task an agent queued on its own, as its `## 🤖 Queued` heading says. */
export interface QueuedTask {
	id: number;
	subject: string;
	/** The agent's one-line `Why:`, empty when it wrote none. */
	why: string;
}

/** The tasks an agent's reply queued, drawn as one card. */
export interface QueuedCard {
	tasks: QueuedTask[];
}

/** Older skills wrote a sprout where the robot is now. */
const QUEUED = /^## (?:🤖|🌱) Queued #(\d+):[ \t]*(.*?)[ \t]*$/;
const WHY = /^Why:[ \t]*(.+?)[ \t]*$/m;

/** Whether `line` is a `## 🤖 Queued #<n>: <subject>` heading. */
export function isQueuedTitle(line: string): boolean {
	return QUEUED.test(line);
}

/** The task a queued heading `line` names, with its `Why:` read from `body`. */
export function queuedTaskOf(line: string, body: string): QueuedTask | null {
	const found = QUEUED.exec(line);
	if (found === null) {
		return null;
	}
	return {
		id: Number(found[1]),
		subject: found[2] as string,
		why: WHY.exec(body)?.[1] ?? "",
	};
}

/**
 * `items` with each run of adjacent queued cards joined into one, so the
 * headings of one reply draw as a single card.
 */
export function groupQueued<T extends { type: string }>(
	items: T[],
	isQueued: (item: T) => QueuedCard | null,
	join: (card: QueuedCard) => T,
): T[] {
	const out: T[] = [];
	let run: QueuedTask[] | null = null;
	for (const item of items) {
		const card = isQueued(item);
		if (card === null) {
			run = null;
			out.push(item);
		} else if (run === null) {
			run = [...card.tasks];
			out.push(join({ tasks: run }));
		} else {
			run.push(...card.tasks);
		}
	}
	return out;
}
