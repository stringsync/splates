import { ANY, DEFAULT_PACE, RULES_FORMAT } from "./rule-names";
import type { AutoPickRules, Rule } from "./rules";

/** Depth sets effort; deep work starts on Opus when settled or a bugfix, otherwise Fable. */
export const DEFAULT_RULES: AutoPickRules = {
	format: RULES_FORMAT,
	threshold: 0.5,
	rules: [
		rule("shallow", ["sonnet", "gpt-6.1-sol"], "low"),
		rule("moderate", ["sonnet", "gpt-6.1-sol"], "medium"),
		deepBugfix(),
		settledDeep(),
		deep(),
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

/**
 * Deep work starts on Fable, the top of Claude, then Astra, Codex's best; each
 * is passed over when its plan is spent or used too fast, and Opus is what
 * remains.
 */
function deep(): Rule {
	return {
		kind: ANY,
		depth: "deep",
		picks: [
			{ agent: "claude", model: "fable", effort: "high" },
			{ agent: "codex", model: "gpt-6-astra", effort: "high" },
			{ agent: "claude", model: "opus", effort: "high" },
		],
	};
}

/** A deep bugfix starts on Opus, sparing Fable's cost for the rest of deep work, then fall back to Fable and Astra. */
function deepBugfix(): Rule {
	return {
		kind: "bugfix",
		depth: "deep",
		picks: [
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "claude", model: "fable", effort: "high" },
			{ agent: "codex", model: "gpt-6-astra", effort: "high" },
		],
	};
}

/** Settled deep work keeps high effort, starting on the focused implementation pick. */
function settledDeep(): Rule {
	return { ...deepBugfix(), kind: ANY, clarity: "settled" };
}
