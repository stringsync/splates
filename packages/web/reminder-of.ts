import type { ReminderCard } from "@splates/server/conversations";
import { planParts } from "./task-plan-parts";

const PREFIX = "reminder ";

/** How a reminder goes among a thread's progress cards, placed by the time it came. */
export function reminderId(at: string): string {
	return `${PREFIX}${at}`;
}

export function isReminderId(id: string): boolean {
	return id.startsWith(PREFIX);
}

/** A hint `splates add` leaves in an empty section, or a picture, neither of which a card can show. */
const UNSHOWN = /<!--[\s\S]*?-->|!\[[^\]]*\]\([^)]*\)/g;

/** The first sentence of `text`, not stopping at the likes of `e.g.`. */
const SENTENCE = /^.*?(?<!\b(?:e\.g|i\.e|etc|vs))[.!?](?=\s|$)/s;

function shown(text: string): string {
	return text.replace(UNSHOWN, "").trim();
}

/**
 * What would remind the person of `task` from its `plan`: the first sentence
 * of After as its one line, the rest of After, and Before; null while After
 * says nothing yet, as the card would have nothing to lead with.
 */
export function reminderCardFor(
	task: string,
	plan: string | null,
): ReminderCard | null {
	const { before, goal } = planParts(plan);
	const after = shown(goal);
	if (after === "") {
		return null;
	}
	const line = SENTENCE.exec(after)?.[0] ?? after.split("\n")[0] ?? after;
	return {
		task,
		line: line.replace(/\s+/g, " "),
		before: shown(before),
		after: after.slice(line.length).trim(),
	};
}
