import type { Scenario } from "../scenario";

/** The definition fields `list --json` shows: data only, never a check's test function. */
export function definitionOf(scenario: Scenario) {
	return {
		prompt: scenario.message,
		checks: (scenario.checks ?? []).map(({ id, about }) => ({ id, about })),
		...(scenario.environment === undefined
			? {}
			: { environment: scenario.environment }),
		...(scenario.example === undefined ? {} : { example: scenario.example }),
		...(scenario.detail === undefined ? {} : { detail: scenario.detail }),
		...(scenario.judge === undefined ? {} : { judge: scenario.judge }),
		...(scenario.judgeWith === undefined
			? {}
			: { judgeWith: scenario.judgeWith }),
		...(scenario.priority === undefined ? {} : { priority: scenario.priority }),
	};
}
