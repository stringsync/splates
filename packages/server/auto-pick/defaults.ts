import { ANY, DEFAULT_PACE, RULES_FORMAT } from "./rule-names";
import type { AutoPickRules, Rule } from "./rules";

/** The Auto pick rules used until the person saves their own, and restored by Reset. */
export const DEFAULT_RULES: AutoPickRules = {
	format: RULES_FORMAT,
	threshold: 0.5,
	rules: [
		rule("shallow", ["sonnet", "gpt-6.1-sol", "kimi-code/k3"], "low"),
		rule("moderate", ["sonnet", "gpt-6.1-sol", "kimi-code/k3.1-pro"], "medium"),
		deepBugfix(),
		settledDeep(),
		deep(),
		rule(ANY, ["opus", "gpt-6-astra", "kimi-code/k3.1-pro"], "medium"),
	],
	pace: DEFAULT_PACE,
};

/** A default rule: Claude first, then Codex, then Kimi, each at `effort`. */
function rule(
	depth: Rule["depth"],
	[claude, codex, kimi]: [string, string, string],
	effort: string,
): Rule {
	const picks = [
		{ agent: "claude", model: claude, effort },
		{ agent: "codex", model: codex, effort },
		{ agent: "kimi", model: kimi, effort },
	];
	return {
		kind: ANY,
		depth,
		picks,
	};
}

/**
 * Deep work starts on Fable, falls back through Astra and Opus, then K3.1 Pro;
 * each is passed over when its plan is spent or used too fast.
 */
function deep(): Rule {
	return {
		kind: ANY,
		depth: "deep",
		picks: [
			{ agent: "claude", model: "fable", effort: "high" },
			{ agent: "codex", model: "gpt-6-astra", effort: "high" },
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
		],
	};
}

/** A deep bugfix starts on Opus, sparing Fable's cost for the rest of deep work, then falls back to Fable, Astra and K3.1 Pro. */
function deepBugfix(): Rule {
	return {
		kind: "bugfix",
		depth: "deep",
		picks: [
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "claude", model: "fable", effort: "high" },
			{ agent: "codex", model: "gpt-6-astra", effort: "high" },
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
		],
	};
}

/** Settled deep work keeps high effort, starting on the focused implementation pick. */
function settledDeep(): Rule {
	return { ...deepBugfix(), kind: ANY, clarity: "settled" };
}
