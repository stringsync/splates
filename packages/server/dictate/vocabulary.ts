/**
 * The most words a take is told: the model's prompt is short, and a list
 * cut off part way helps less than a shorter one.
 */
export const MAX_WORDS = 50;

/**
 * Project words a speech model should spell as written: splates and the
 * project always, then the project's config's, then the person's, each once.
 */
export function words(
	project: string,
	...lists: readonly (readonly string[])[]
): string[] {
	return [...new Set(["splates", project, ...lists.flat()])].slice(
		0,
		MAX_WORDS,
	);
}

/** The prompt that gets `listed` words spelled their way. */
export function vocabulary(listed: readonly string[]): string {
	return `A developer dictating a prompt for a coding agent. Words that may come up: ${listed.join(", ")}.`;
}
