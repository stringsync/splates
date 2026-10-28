import type { SplatesEventView } from "./splates-event";

/** The task and lane behind a queued task's start. */
export interface QueueStart {
	task: string;
	queued: number;
	lane: number;
}

const START =
	/^\[SPLATES TASK (\S+)\]\n\nsplates server started this task for queued task #(\d+) from the queue, which lane (\d+) queued:/u;

/** The start `text` tells, or null for any other message. */
export function queueStartOf(text: string): QueueStart | null {
	const found = START.exec(text);
	return found === null
		? null
		: {
				task: found[1] ?? "",
				queued: Number(found[2]),
				lane: Number(found[3]),
			};
}

/** The line a queued lane's start draws, the whole message on hover. */
export function startLine(
	start: QueueStart,
	lanes: readonly { id: number; name: string }[],
	at: string | null,
	title: string,
): SplatesEventView {
	const name = lanes.find((each) => each.id === start.lane)?.name;
	return {
		words: ["Started", { kind: "task", task: start.task }],
		mobile: {
			words: [
				"Started",
				{ kind: "task", task: start.task },
				"from lane",
				{ kind: "lane", id: start.lane, name: name ?? String(start.lane) },
			],
		},
		at,
		title,
	};
}
