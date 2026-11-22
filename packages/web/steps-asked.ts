import type { ThreadMessage } from "@assistant-ui/react";
import type { Steps } from "@splates/server/plans/browser";
import { textOf } from "./card-reply";

/**
 * What the person asks the agent from a Steps card's pop-out: their words,
 * after a line naming the step they are on, so the agent knows where they
 * are from the message alone, whatever harness it runs in.
 */
export function askedFrom(steps: Steps, done: number, words: string): string {
	const count = steps.steps.length;
	const on = Math.min(done, count - 1);
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
 * One question asked from the pop-out and what the agent has said since:
 * the words of its replies, whether one holds a card the pop-out does not
 * draw, and whether it is still answering.
 */
export interface Exchange {
	id: string;
	step: number;
	words: string;
	answers: string[];
	/** Whether a reply holds a card other than Steps, opened in the tab. */
	carded: boolean;
	/** Whether the agent is still at work on it, with nothing more since. */
	waiting: boolean;
}

/** Data parts that are no card: Steps, which the pop-out draws, and the thread's own rows. */
const UNCARDED = [
	"steps",
	"work",
	"event",
	"background",
	"compaction",
	"interrupted",
	"stopped",
];

/** The questions asked from the pop-out of the Steps card titled `title`. */
export function exchangesOf(
	messages: readonly ThreadMessage[],
	title: string,
	running: boolean,
): Exchange[] {
	const found: Exchange[] = [];
	let open: Exchange | null = null;
	for (const message of messages) {
		if (message.role === "user") {
			const asked = readAsked(textOf(message));
			open =
				asked !== null && asked.title === title
					? {
							id: message.id,
							step: asked.step,
							words: asked.words,
							answers: [],
							carded: false,
							waiting: false,
						}
					: null;
			if (open !== null) {
				found.push(open);
			}
			continue;
		}
		if (open === null || message.role !== "assistant") {
			continue;
		}
		for (const part of message.content) {
			if (part.type === "text" && part.text.trim() !== "") {
				open.answers.push(part.text.trim());
			} else if (part.type === "data" && !UNCARDED.includes(part.name)) {
				open.carded = true;
			}
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
