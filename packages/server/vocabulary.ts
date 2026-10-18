/** Project words a speech model should spell as written. */
export function words(project: string): string[] {
	return [...new Set(["splates", project])];
}

/** The prompt that gets the project's own words spelled its way. */
export function vocabulary(project: string): string {
	return `A developer dictating a prompt for a coding agent. Words that may come up: ${words(project).join(", ")}.`;
}
