/** What a chat with an agent takes to mean todo `id`. */
export function todoReference(id: number): string {
	return `[ARBOR TODO #${id}]`;
}

/** What a chat with an agent takes to mean "work down lane `id`". */
export function laneReference(id: number): string {
	return `[ARBOR LANE ${id}]`;
}

/** What a chat with an agent takes to mean "claim `task` and carry on with it". */
export function taskReference(task: string): string {
	return `[ARBOR TASK ${task}]`;
}

/**
 * What asks an agent to bring its `ARBOR.md` up to date and stop, as before a
 * restart: the arbor skill says what it means.
 */
export const CHECKPOINT = "[ARBOR CHECKPOINT]";

/**
 * What asks an agent to carry on from where its `ARBOR.md` says it stopped,
 * after a checkpoint: the arbor skill says what it means.
 */
export const RESUME = "[ARBOR RESUME]";

/** One `[ARBOR ...]` directive at the start of a text, and the space after it. */
const LEADING = /^\s*(\[ARBOR [A-Z]+(?: [^\]\s]+)?\])(?:\s+|$)/;

/**
 * The directives `text` starts with, in order, and what follows them; none
 * when it starts with anything else.
 */
export function leadingDirectives(text: string): {
	directives: string[];
	rest: string;
} {
	const directives: string[] = [];
	let rest = text;
	for (
		let found = LEADING.exec(rest);
		found !== null;
		found = LEADING.exec(rest)
	) {
		directives.push(found[1] as string);
		rest = rest.slice(found[0].length);
	}
	return { directives, rest };
}
