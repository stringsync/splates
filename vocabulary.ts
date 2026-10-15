import type { System } from "./systems";

/**
 * Every word a prompt to an agent in `project` may use that a speech model
 * would spell its own way: arbor, the project's name, and each system's name
 * and aliases.
 */
export function words(
	project: string,
	systems: Record<string, System>,
): string[] {
	const words = new Set(["arbor", project]);
	for (const [name, system] of Object.entries(systems)) {
		words.add(name);
		for (const alias of system.aliases ?? []) {
			words.add(alias);
		}
	}
	return [...words];
}

/** The prompt that gets the project's own words spelled its way. */
export function vocabulary(
	project: string,
	systems: Record<string, System>,
): string {
	return `A developer dictating a prompt for a coding agent. Words that may come up: ${words(project, systems).join(", ")}.`;
}
