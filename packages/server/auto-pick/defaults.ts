import { ANY, DEFAULT_PACE, RULES_FORMAT } from "./rule-names";
import type { AutoPickRules, Rule } from "./rules";

/** The Auto pick rules used until the person saves their own, and restored by Reset. */
export const DEFAULT_RULES: AutoPickRules = {
	format: RULES_FORMAT,
	threshold: 0.5,
	rules: [
		rule(
			"shallow",
			["sonnet", "gpt-6.1-sol", "kimi-code/k3.1-pro-highspeed"],
			"low",
		),
		designModerate("design"),
		designModerate("open"),
		rule("moderate", ["sonnet", "gpt-6.1-sol", "kimi-code/k3.1-pro"], "medium"),
		deepBugfix(),
		designDeep("design"),
		designDeep("open"),
		deep(),
		fallback(),
	],
	pace: DEFAULT_PACE,
};

/** A default rule: Claude first, then Codex, then Kimi, each at `effort`. */
function rule(
	depth: Rule["depth"],
	[claude, codex, kimi]: [string, string, string],
	effort: string,
): Rule {
	return {
		kind: ANY,
		depth,
		picks: [
			{ agent: "claude", model: claude, effort },
			{ agent: "codex", model: codex, effort },
			{ agent: "kimi", model: kimi, effort },
		],
	};
}

/** Moderate design or open-ended work starts on Opus, then Sonnet, then K3.1 Pro. */
function designModerate(kind: "design" | "open"): Rule {
	return {
		kind,
		depth: "moderate",
		picks: [
			{ agent: "claude", model: "opus", effort: "medium" },
			{ agent: "claude", model: "sonnet", effort: "medium" },
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
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

/** Work the judge could not place starts on Opus, then Sonnet, then Sol. */
function fallback(): Rule {
	return {
		kind: ANY,
		depth: ANY,
		picks: [
			{ agent: "claude", model: "opus", effort: "medium" },
			{ agent: "claude", model: "sonnet", effort: "medium" },
			{ agent: "codex", model: "gpt-6.1-sol", effort: "medium" },
		],
	};
}
