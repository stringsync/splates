import {
	Budgets,
	parseSpend,
	saySpend,
	windowStart,
} from "@webappwiz/cli/budget-policy";
import type { Limit, Spend } from "@webappwiz/scry/config";

/** All eval targets share total tokens, unlike Scry's separate input-token roles. */
export interface EvalBudgetConfig {
	budgets: Exclude<Spend, "unlimited">;
}
export interface Declaration {
	spend: EvalBudgetConfig["budgets"];
	from: string;
}

export function declared(value: unknown, from: string): Declaration {
	if (value === "unlimited") {
		throw new Error(
			"Eval budgets cannot be unlimited; invocation dollar/token guardrails always apply",
		);
	}
	Budgets.from({ som: "nothing", llm: value }, from);
	const spend = value as Declaration["spend"];
	for (const limit of limits(spend)) {
		if (!Number.isSafeInteger(limit.tokens) || limit.tokens < 0) {
			throw new Error("Eval token limits must be nonnegative safe integers");
		}
		if (limit.within !== undefined && !/^[1-9]\d*[hdw]$/.test(limit.within)) {
			throw new Error(
				"Eval rolling windows must be positive hours, days or weeks",
			);
		}
		if (!Number.isFinite(windowStart(limit, Date.now()))) {
			throw new Error("Eval window is outside the supported date range");
		}
	}
	return { spend, from };
}
export function parseEvalSpend(value: string): Declaration["spend"] {
	return declared(parseSpend(value), "eval budgets set").spend;
}
export function limits(spend: Declaration["spend"]): Limit[] {
	return spend === "nothing"
		? [{ tokens: 0, per: "check" }]
		: Array.isArray(spend)
			? spend
			: [spend];
}
export { saySpend, windowStart };
