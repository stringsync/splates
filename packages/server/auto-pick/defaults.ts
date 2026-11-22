import { DEFAULT_PACE, RULES_FORMAT } from "./cells";
import { DEFAULT_LINEUPS } from "./default-lineups";
import type { AutoPickRules } from "./rules";

/**
 * The Auto pick rules used until the person saves their own, and restored by
 * Reset: DevOps work never goes to Codex, deep work goes to the careful
 * lineup, or the hardest when its kind is unsure, moderate design and
 * open-ended work to the thoughtful one, shallow work to the quick one, and
 * the rest to the standard one.
 */
export const DEFAULT_RULES: AutoPickRules = {
	format: RULES_FORMAT,
	threshold: 0.5,
	lineups: DEFAULT_LINEUPS.map((each) => ({
		...each,
		picks: each.picks.map((pick) => ({ ...pick })),
	})),
	routes: {
		bugfix: {
			unsure: "standard",
			shallow: "quick",
			moderate: "standard",
			deep: "careful",
		},
		design: {
			unsure: "standard",
			shallow: "quick",
			moderate: "thoughtful",
			deep: "careful",
		},
		open: {
			unsure: "standard",
			shallow: "quick",
			moderate: "thoughtful",
			deep: "careful",
		},
		devops: {
			unsure: "infra",
			shallow: "infra",
			moderate: "infra",
			deep: "infra",
		},
		unsure: {
			unsure: "standard",
			shallow: "quick",
			moderate: "standard",
			deep: "hardest",
		},
	},
	pace: DEFAULT_PACE,
};
