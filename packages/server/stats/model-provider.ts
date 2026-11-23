import { DEFAULT_AGENTS, type RosterAgent } from "../models";

/** Model makers with marks in the app, independent of the agent running them. */
export type ModelProvider = "anthropic" | "openai" | "google" | "moonshot";

const MODEL_FAMILIES: readonly [RegExp, ModelProvider][] = [
	[/^(?:anthropic|claude|opus|sonnet|haiku|fable)\b/, "anthropic"],
	[/^(?:openai|gpt|o1|o3|o4)\b/, "openai"],
	[/^(?:google|gemini|gemma)\b/, "google"],
	[/^(?:moonshotai|moonshot|kimi)\b/, "moonshot"],
];

/**
 * Resolves a recorded model ID or name to the maker whose mark it can show.
 * The roster supplies display aliases like 6 Astra, and family names cover
 * older records and models served by an agent from a different maker.
 */
export function modelProvider(
	model: string | null,
	agents: readonly RosterAgent[],
): ModelProvider | null {
	const name = model?.trim().toLowerCase();
	if (!name) {
		return null;
	}
	const family = namedProvider(name);
	if (family !== null) {
		return family;
	}
	const matches = new Set(
		[...agents, ...DEFAULT_AGENTS].flatMap(({ models }) =>
			models
				.filter((each) => each.name.trim().toLowerCase() === name)
				.map((each) => namedProvider(each.id.toLowerCase())),
		),
	);
	return matches.size === 1 ? (matches.values().next().value ?? null) : null;
}

function namedProvider(name: string): ModelProvider | null {
	return MODEL_FAMILIES.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}
