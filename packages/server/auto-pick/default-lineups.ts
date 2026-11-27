import type { Lineup } from "./rules";

/**
 * The default Auto pick lineups, from quick tasks to the hardest work.
 * Each offers one model per agent, tried in fallback order.
 * @internal
 */
export const DEFAULT_LINEUPS: readonly Lineup[] = [
	// Sonnet leads everything short of deep work; K3.1 Pro is kept for deep
	// work alone, and its highspeed variant, which spends twice the tokens,
	// is never picked. Each Claude pick falls back to the same model and
	// effort on Antigravity, whose Claude quota is its own.
	{
		id: "quick",
		name: "Quick",
		color: "emerald",
		picks: [
			{ agent: "claude", model: "sonnet", effort: "low" },
			{ agent: "antigravity", model: "claude-sonnet-5-5", effort: "low" },
			{ agent: "codex", model: "gpt-6.1-sol", effort: "low" },
		],
	},
	{
		id: "standard",
		name: "Standard",
		color: "sky",
		picks: [
			{ agent: "claude", model: "sonnet", effort: "medium" },
			{ agent: "antigravity", model: "claude-sonnet-5-5", effort: "medium" },
			{ agent: "codex", model: "gpt-6.1-sol", effort: "medium" },
		],
	},
	{
		id: "thoughtful",
		name: "Thoughtful",
		color: "violet",
		picks: [
			{ agent: "claude", model: "sonnet", effort: "high" },
			{ agent: "antigravity", model: "claude-sonnet-5-5", effort: "high" },
			{ agent: "codex", model: "gpt-6.1-sol", effort: "medium" },
		],
	},
	{
		id: "careful",
		name: "Careful",
		color: "pink",
		picks: [
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "antigravity", model: "claude-opus-5-5", effort: "high" },
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
			{ agent: "codex", model: "gpt-6-astra", effort: "high" },
		],
	},
	{
		id: "hardest",
		name: "Hardest",
		color: "red",
		picks: [
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "max" },
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "antigravity", model: "claude-opus-5-5", effort: "high" },
			{ agent: "codex", model: "gpt-6-astra", effort: "high" },
		],
	},
	{
		id: "infra",
		name: "Infra",
		color: "amber",
		picks: [
			{ agent: "claude", model: "sonnet", effort: "medium" },
			{ agent: "antigravity", model: "claude-sonnet-5-5", effort: "medium" },
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
		],
	},
];
