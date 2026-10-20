import { ANY, DEFAULT_PACE, RULES_FORMAT } from "./rule-names";
import type { AutoPickRules, Rule } from "./rules";

/**
 * The mapping a machine starts with, over the default roster: each rule picks
 * a Claude model, then the Codex model of the same tier for when Claude's
 * plan is nearly used up, except lookups and mechanical work, which go to
 * Codex first and fall back to Claude. Specific rules sit above the general
 * ones they would otherwise lose to. A pick whose plan is used faster than
 * its window goes by gives way to the next too.
 */
export const DEFAULT_RULES: AutoPickRules = {
	format: RULES_FORMAT,
	threshold: 0.5,
	rules: [
		rule("lookup", ANY, ["haiku", "gpt-6-luna"], "low", "codex"),
		rule("mechanical", "easy", ["haiku", "gpt-6-luna"], "low", "codex"),
		rule("mechanical", ANY, ["sonnet", "gpt-6.1-sol"], "medium", "codex"),
		rule("bugfix", "hard", ["opus", "gpt-6-astra"], "high"),
		rule("bugfix", ANY, ["sonnet", "gpt-6.1-sol"], "medium"),
		rule("design", ANY, ["opus", "gpt-6-astra"], "high"),
		// Codex has no fourth tier, so its strongest stands in for Fable.
		rule("open", "hard", ["fable", "gpt-6-astra"], "high"),
		rule("open", ANY, ["opus", "gpt-6-astra"], "high"),
		rule(ANY, "easy", ["sonnet", "gpt-6.1-sol"], "low"),
		rule(ANY, "hard", ["opus", "gpt-6-astra"], "high"),
		rule(ANY, ANY, ["opus", "gpt-6-astra"], "medium"),
	],
	pace: DEFAULT_PACE,
};

/** A default rule: each model at `effort`, `first`'s agent ahead of the other. */
function rule(
	kind: Rule["kind"],
	difficulty: Rule["difficulty"],
	[claude, codex]: [string, string],
	effort: string,
	first: "claude" | "codex" = "claude",
): Rule {
	const picks = [
		{ agent: "claude", model: claude, effort },
		{ agent: "codex", model: codex, effort },
	];
	return {
		kind,
		difficulty,
		picks: first === "claude" ? picks : picks.reverse(),
	};
}
