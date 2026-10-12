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
