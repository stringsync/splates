/** How many of a spec's last `of` graded runs on an agent must pass. */
export interface PassRule {
	need: number;
	of: number;
}

/** Every spec's rule unless it sets its own: 2 of its last 3 graded runs. */
export const DEFAULT_PASS: PassRule = { need: 2, of: 3 };

/** Where an agent stands on a spec: passed, a pass is out of reach, or it needs more runs. */
export type Standing = "pass" | "fail" | "needs-runs";

/** The last `rule.of` of `graded` (oldest first, true for a pass), and how they stand. */
export function standingOf(
	graded: readonly boolean[],
	rule: PassRule = DEFAULT_PASS,
): { standing: Standing; passed: number; window: number } {
	const window = graded.slice(-rule.of);
	const passed = window.filter(Boolean).length;
	const failed = window.length - passed;
	const standing: Standing =
		passed >= rule.need
			? "pass"
			: failed > rule.of - rule.need
				? "fail"
				: "needs-runs";
	return { standing, passed, window: window.length };
}

/** `value` as a rule: whole numbers with 1 <= need <= of; null when it is not one. */
export function parsePassRule(value: unknown): PassRule | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const { need, of } = value as Record<string, unknown>;
	return typeof need === "number" &&
		typeof of === "number" &&
		Number.isInteger(need) &&
		Number.isInteger(of) &&
		need >= 1 &&
		need <= of
		? { need, of }
		: null;
}
