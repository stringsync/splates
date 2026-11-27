/** One task an agent queued on its own, as its `## 🤖 Queued` heading says. */
export interface QueuedTask {
	id: number;
	subject: string;
	/** The agent's one-line `Why:`, empty when it wrote none. */
	why: string;
}

/** One lane an agent queued on its own, as its `## 🤖 Queued lane` heading says. */
export interface QueuedLane {
	id: number;
	name: string;
	/** The agent's one-line `Why:`, empty when it wrote none. */
	why: string;
}

/** The tasks or lane an agent's reply queued, drawn as one card. */
export interface QueuedCard {
	tasks: QueuedTask[];
	lane?: QueuedLane;
}

/** Older skills wrote a sprout where the robot is now. */
const QUEUED = /^## (?:🤖|🌱) Queued #(\d+):[ \t]*(.*?)[ \t]*$/;
const QUEUED_LANE = /^## (?:🤖|🌱) Queued lane #?(\d+):[ \t]*(.*?)[ \t]*$/;
const WHY = /^Why:[ \t]*(.+?)[ \t]*$/m;

/** Whether `line` is a `## 🤖 Queued #<n>: <subject>` or `## 🤖 Queued lane <n>: <name>` heading. */
export function isQueuedTitle(line: string): boolean {
	return QUEUED.test(line) || QUEUED_LANE.test(line);
}

/** The task or lane a queued heading `line` names, with its `Why:` read from `body`. */
export function queuedCardOf(line: string, body: string): QueuedCard | null {
	const task = QUEUED.exec(line);
	if (task !== null) {
		return {
			tasks: [
				{
					id: Number(task[1]),
					subject: task[2] as string,
					why: WHY.exec(body)?.[1] ?? "",
				},
			],
		};
	}
	const lane = QUEUED_LANE.exec(line);
	if (lane !== null) {
		return {
			tasks: [],
			lane: {
				id: Number(lane[1]),
				name: lane[2] as string,
				why: WHY.exec(body)?.[1] ?? "",
			},
		};
	}
	return null;
}

/**
 * `items` with each run of adjacent queued-task cards joined into one, so the
 * task headings of one reply draw as a single card while lane cards stay separate.
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
		if (card === null || card.lane !== undefined) {
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
