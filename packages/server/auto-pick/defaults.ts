import type { Rule } from "./rules";
import { ANY, type AutoPickRules, RULES_FORMAT } from "./rules";

/**
 * The mapping a machine starts with, over the default roster: each rule picks
 * a Claude model, then the Codex model of the same tier for when Claude's
 * plan is nearly used up. Specific rules sit above the general ones they
 * would otherwise lose to.
 */
export const DEFAULT_RULES: AutoPickRules = {
	format: RULES_FORMAT,
	threshold: 0.5,
	rules: [
		rule("lookup", ANY, ["haiku", "gpt-6-luna"], "low"),
		rule("mechanical", "easy", ["haiku", "gpt-6-luna"], "low"),
		rule("mechanical", ANY, ["sonnet", "gpt-6.1-sol"], "medium"),
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
};

/** A default rule: each model, Claude's then Codex's, at `effort`. */
function rule(
	kind: Rule["kind"],
	difficulty: Rule["difficulty"],
	[claude, codex]: [string, string],
	effort: string,
): Rule {
	return {
		kind,
		difficulty,
		picks: [
			{ agent: "claude", model: claude, effort },
			{ agent: "codex", model: codex, effort },
		],
	};
}
