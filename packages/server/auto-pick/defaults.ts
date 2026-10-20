import { ANY, DEFAULT_PACE, RULES_FORMAT } from "./rule-names";
import type { AutoPickRules, Rule } from "./rules";

/** Depth alone routes the defaults; plan and pace still pass over picks in order. */
export const DEFAULT_RULES: AutoPickRules = {
	format: RULES_FORMAT,
	threshold: 0.5,
	rules: [
		rule("shallow", ["sonnet", "gpt-6.1-sol"], "low"),
		rule("moderate", ["sonnet", "gpt-6.1-sol"], "medium"),
		rule("deep", ["opus", "gpt-6-astra"], "high"),
		rule(ANY, ["opus", "gpt-6-astra"], "medium"),
	],
	pace: DEFAULT_PACE,
};

/** A default rule: Claude first, then Codex, each at `effort`. */
function rule(
	depth: Rule["depth"],
	[claude, codex]: [string, string],
	effort: string,
): Rule {
	const picks = [
		{ agent: "claude", model: claude, effort },
		{ agent: "codex", model: codex, effort },
	];
	return {
		kind: ANY,
		depth,
		picks,
	};
}
