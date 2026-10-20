import { DIFFICULTIES, KINDS } from "./classes";
import type { Pace, Rule } from "./rules";

/** The rules' own format. */
export const RULES_FORMAT = 1;

/** The rule every mapping ends on, so every classification maps somewhere. */
export const ANY = "*" as const;

/** The pace a mapping without one takes. */
export const DEFAULT_PACE: Pace = { on: true, slack: 0.1, spent: 0.95 };

/** What a rule matches in words: `Mechanical, any difficulty`. */
export function ruleLabel(rule: Pick<Rule, "kind" | "difficulty">): string {
	const kind =
		rule.kind === ANY
			? "any kind"
			: (KINDS.find((each) => each.id === rule.kind)?.label ?? rule.kind);
	const difficulty =
		rule.difficulty === ANY
			? "any difficulty"
			: (DIFFICULTIES.find((each) => each.id === rule.difficulty)?.label ??
				rule.difficulty);
	return `${kind}, ${difficulty}`;
}
