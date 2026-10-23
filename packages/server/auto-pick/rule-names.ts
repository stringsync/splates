import { CLARITIES, DEPTHS, KINDS } from "./classes";
import type { Pace, Rule } from "./rules";

/** The rules' own format. */
export const RULES_FORMAT = 2;

/** The rule every mapping ends on, so every classification maps somewhere. */
export const ANY = "*" as const;

/** The pace a mapping without one takes. */
export const DEFAULT_PACE: Pace = { on: true, slack: 0.1, spent: 0.95 };

/** What a rule matches in words: `Mechanical, any depth`. */
export function ruleLabel(
	rule: Pick<Rule, "kind" | "depth" | "clarity">,
): string {
	const kind =
		rule.kind === ANY
			? "any kind"
			: (KINDS.find((each) => each.id === rule.kind)?.label ?? rule.kind);
	const depth =
		rule.depth === ANY
			? "any depth"
			: (DEPTHS.find((each) => each.id === rule.depth)?.label ?? rule.depth);
	const clarity =
		rule.clarity === undefined || rule.clarity === ANY
			? ""
			: `, ${CLARITIES.find((each) => each.id === rule.clarity)?.label ?? rule.clarity}`;
	return `${kind}, ${depth}${clarity}`;
}
