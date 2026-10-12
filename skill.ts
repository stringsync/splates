import text from "./arbor.skill.md" with { type: "text" };

/**
 * The agent skill that teaches an agent to work through arbor, as this release
 * shipped it: `arbor init` and `arbor update` install it in a repository, and
 * `@webappwiz/cli` offers it beside its own. Imported rather than read off disk
 * so it travels inside the build.
 */
export const skill: string = text;
