import { earlyWarningOf, warningLines } from "./early-warning";
import type { SplatesEventView } from "./splates-event";

/**
 * What splates server tells an agent whose task a queued lane started, read
 * back from its words (`queuePrompt` in the server's `queue/runner.ts`): the
 * task, the queued task it took and the lane that queued it. A task the
 * person queued is a regular message.
 */
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
		words: [
			"Started",
			{ kind: "task", task: start.task },
			"from lane",
			{ kind: "lane", id: start.lane, name: name ?? String(start.lane) },
		],
		at,
		title,
	};
}

/** The event lines splates server's words to an agent draw in their place, null for any other words. */
export function serverToldLines(
	text: string,
	lanes: readonly { id: number; name: string }[],
	at: string | null,
): SplatesEventView[] | null {
	const warning = earlyWarningOf(text);
	if (warning !== null) {
		return warningLines(warning, at, text);
	}
	const start = queueStartOf(text);
	return start === null ? null : [startLine(start, lanes, at, text)];
}
