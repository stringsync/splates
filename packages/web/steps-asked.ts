import type { ThreadMessage, ThreadMessageLike } from "@assistant-ui/react";
import type { Steps } from "@splates/server/plans/browser";
import { textOf } from "./card-reply";

/**
 * What the person asks the agent from a Steps card's pop-out: their words,
 * after a line naming the step they are reading, so the agent has the context
 * from the message alone, whatever harness it runs in.
 */
export function askedFrom(
	steps: Steps,
	reading: number,
	words: string,
): string {
	const count = steps.steps.length;
	const on = Math.min(reading, count - 1);
	const line = (steps.steps[on] ?? "").split("\n")[0] ?? "";
	return `(From the steps pop-out, on step ${on + 1} of ${count} of "${steps.title}": ${line})\n\n${words}`;
}

/** A message `askedFrom` wrote, read back: the card, the step and the words. */
export interface Asked {
	title: string;
	step: number;
	words: string;
}

const ASKED =
	/^\(From the steps pop-out, on step (\d+) of \d+ of "(.*)": [^\n]*\)\n\n([\s\S]*)$/;

export function readAsked(text: string): Asked | null {
	// The server says it back with \r\n line ends, which the sent copy lacks.
	const found = ASKED.exec(text.replaceAll("\r\n", "\n"));
	return found === null
		? null
		: {
				step: Number(found[1]),
				title: found[2] as string,
				words: found[3] as string,
			};
}

/**
 * One question asked from the pop-out and what the agent has said since: the
 * thread's own messages, by index, drawn as the thread draws them, and
 * whether the agent is still at work on it.
 */
export interface Exchange {
	id: string;
	step: number;
	/** Its question's index in the thread, then each reply's. */
	messages: number[];
	/** Whether the agent is still at work on it, with nothing more since. */
	waiting: boolean;
}

/** The questions asked from the pop-out of the Steps card titled `title`. */
export function exchangesOf(
	messages: readonly ThreadMessage[],
	title: string,
	running: boolean,
): Exchange[] {
	const found: Exchange[] = [];
	let open: Exchange | null = null;
	for (const [index, message] of messages.entries()) {
		if (message.role === "user") {
			const asked = readAsked(textOf(message));
			open =
				asked !== null && asked.title === title
					? {
							id: message.id,
							step: asked.step,
							messages: [index],
							waiting: false,
						}
					: null;
			if (open !== null) {
				found.push(open);
			}
		} else if (open !== null && message.role === "assistant") {
			open.messages.push(index);
		}
	}
	const last = found.at(-1);
	// Still at work when the last thing in the thread is that question, or its answer so far.
	if (last !== undefined && running && open === last) {
		last.waiting = true;
	}
	return found;
}

/** Every version of the Steps card titled `title`, oldest first. */
export function versionsOf(
	messages: readonly ThreadMessage[],
	title: string,
): Steps[] {
	return messages.flatMap((message) =>
		message.role !== "assistant"
			? []
			: message.content.flatMap((part) =>
					part.type === "data" &&
					part.name === "steps" &&
					(part.data as { steps: Steps }).steps.title === title
						? [(part.data as { steps: Steps }).steps]
						: [],
				),
	);
}

/**
 * The steps of `next` that differ from `before`, by number from 0, each with
 * the words it had; a step `before` lacked has none.
 */
export function changedSteps(
	before: Steps | null,
	next: Steps,
): Map<number, string | null> {
	const changed = new Map<number, string | null>();
	if (before === null) {
		return changed;
	}
	next.steps.forEach((text, i) => {
		const was = before.steps[i];
		if (was !== text) {
			changed.set(i, was ?? null);
		}
	});
	return changed;
}

/**
 * What the person sends from a Steps card's Done: that they are finished,
 * and how many steps they checked off, which need not be all of them.
 */
export function doneFrom(steps: Steps, done: number): string {
	const count = steps.steps.length;
	return `(Done with the steps "${steps.title}": ${Math.min(done, count)} of ${count} checked off)`;
}

/** A message `doneFrom` wrote, read back. */
export interface Finished {
	title: string;
	checked: number;
	count: number;
}

const DONE = /^\(Done with the steps "(.*)": (\d+) of (\d+) checked off\)$/;

export function readDone(text: string): Finished | null {
	const found = DONE.exec(text.trim());
	return found === null
		? null
		: {
				title: found[1] as string,
				checked: Number(found[2]),
				count: Number(found[3]),
			};
}

/**
 * Whether the newest version of the Steps card titled `title` was marked
 * done: a Done for it after the message that holds that version. A newer
 * version starts over, with Done of its own.
 */
export function finishedOf(
	messages: readonly ThreadMessage[],
	title: string,
): Finished | null {
	const newest = messages.findLastIndex(
		(message) => versionsOf([message], title).length > 0,
	);
	for (const message of messages.slice(newest + 1)) {
		const finished = message.role === "user" ? readDone(textOf(message)) : null;
		if (finished !== null && finished.title === title) {
			return finished;
		}
	}
	return null;
}

/** One part of a message as the thread is fed it. */
type LikePart = Exclude<ThreadMessageLike["content"], string>[number];

function likeText(message: ThreadMessageLike): string {
	return typeof message.content === "string"
		? message.content
		: message.content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("");
}

/**
 * The messages of a thread, as it is fed them, that belong to the pop-out of
 * the Steps card titled `title`: each question asked from it and what the
 * agent said after, up to the person's next message.
 */
export function askedOnly(
	messages: readonly ThreadMessageLike[],
	title: string,
): ThreadMessageLike[] {
	const kept: ThreadMessageLike[] = [];
	let open = false;
	for (const message of messages) {
		if (message.role === "user") {
			open = readAsked(likeText(message))?.title === title;
		}
		if (open) {
			kept.push(message);
		}
	}
	return kept;
}

/** Every version of the Steps card titled `title` in a thread as it is fed, oldest first. */
export function versionsIn(
	messages: readonly ThreadMessageLike[],
	title: string,
): Steps[] {
	return messages.flatMap((message) =>
		message.role !== "assistant" || typeof message.content === "string"
			? []
			: message.content.flatMap((part: LikePart) =>
					part.type === "data-steps" &&
					(part.data as { steps: Steps }).steps.title === title
						? [(part.data as { steps: Steps }).steps]
						: [],
				),
	);
}

/** `finishedOf` for a thread as it is fed. */
export function finishedIn(
	messages: readonly ThreadMessageLike[],
	title: string,
): Finished | null {
	const newest = messages.findLastIndex(
		(message) => versionsIn([message], title).length > 0,
	);
	for (const message of messages.slice(newest + 1)) {
		const finished =
			message.role === "user" ? readDone(likeText(message)) : null;
		if (finished !== null && finished.title === title) {
			return finished;
		}
	}
	return null;
}
