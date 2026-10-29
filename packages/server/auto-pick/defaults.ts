import { ANY, DEFAULT_PACE, RULES_FORMAT } from "./rule-names";
import type { AutoPickRules, Rule } from "./rules";

/** The Auto pick rules used until the person saves their own, and restored by Reset. */
export const DEFAULT_RULES: AutoPickRules = {
	format: RULES_FORMAT,
	threshold: 0.5,
	rules: [
		shallow(),
		designModerate("design"),
		designModerate("open"),
		moderate(),
		deepBugfix(),
		designDeep("design"),
		designDeep("open"),
		deep(),
		fallback(),
	],
	pace: DEFAULT_PACE,
};

// Sonnet leads everything short of deep work; K3.1 Pro is kept for deep work
// alone, and its highspeed variant, which spends twice the tokens, is never picked.

/** Shallow work starts on Sonnet, then Sol, then Haiku, at low effort. */
function shallow(): Rule {
	return {
		kind: ANY,
		depth: "shallow",
		picks: [
			{ agent: "claude", model: "sonnet", effort: "low" },
			{ agent: "codex", model: "gpt-6.1-sol", effort: "low" },
			{ agent: "claude", model: "haiku", effort: "low" },
		],
	};
}

/** Moderate design or open-ended work starts on Sonnet at high effort, then Opus, then Sol. */
function designModerate(kind: "design" | "open"): Rule {
	return {
		kind,
		depth: "moderate",
		picks: [
			{ agent: "claude", model: "sonnet", effort: "high" },
			{ agent: "claude", model: "opus", effort: "medium" },
			{ agent: "codex", model: "gpt-6.1-sol", effort: "medium" },
		],
	};
}

/** Other moderate work starts on Sonnet, then Sol, then Opus, at medium effort. */
function moderate(): Rule {
	return {
		kind: ANY,
		depth: "moderate",
		picks: [
			{ agent: "claude", model: "sonnet", effort: "medium" },
			{ agent: "codex", model: "gpt-6.1-sol", effort: "medium" },
			{ agent: "claude", model: "opus", effort: "medium" },
		],
	};
}

/** A deep bugfix starts on Opus, then K3.1 Pro at max effort, then Astra. */
function deepBugfix(): Rule {
	return {
		kind: "bugfix",
		depth: "deep",
		picks: [
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "max" },
			{ agent: "codex", model: "gpt-6-astra", effort: "high" },
		],
	};
}

/** Deep design or open-ended work starts on Opus, then K3.1 Pro, then Astra. */
function designDeep(kind: "design" | "open"): Rule {
	return {
		kind,
		depth: "deep",
		picks: [
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
			{ agent: "codex", model: "gpt-6-astra", effort: "high" },
		],
	};
}

/**
 * Other deep work starts on K3.1 Pro at max effort, then Opus, then Astra;
 * each is passed over when its plan is spent or used too fast.
 */
function deep(): Rule {
	return {
		kind: ANY,
		depth: "deep",
		picks: [
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "max" },
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "codex", model: "gpt-6-astra", effort: "high" },
		],
	};
}

/** Work the judge could not place starts on Sonnet, then Opus, then Sol. */
function fallback(): Rule {
	return {
		kind: ANY,
		depth: ANY,
		picks: [
			{ agent: "claude", model: "sonnet", effort: "medium" },
			{ agent: "claude", model: "opus", effort: "medium" },
			{ agent: "codex", model: "gpt-6.1-sol", effort: "medium" },
		],
	};
}
