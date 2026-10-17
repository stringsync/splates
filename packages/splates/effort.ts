import type { Setting } from "./conversation-state";
import { fail } from "./exit";

/** The setting a thinking level goes in, as ACP names its category. */
const THOUGHT_LEVEL = "thought_level";

/** The thinking levels `offered` lets an agent work at, by value; none without a thinking setting. */
export function effortsOf(offered: Setting[]): string[] {
	return (
		offered
			.find((each) => each.category === THOUGHT_LEVEL)
			?.options.map((each) => each.value) ?? []
	);
}

/** The setting `effort` goes in, by its id; none when it is unset or `offered` has nowhere for it. */
export function effortSettings(
	effort: string | undefined,
	offered: Setting[],
): Record<string, string> {
	const setting = offered.find((each) => each.category === THOUGHT_LEVEL);
	return effort === undefined || setting === undefined
		? {}
		: { [setting.id]: effort };
}

/**
 * `effort` as one of the thinking levels `agent` offers, by its value or
 * name in any case, so it goes in the setting as the agent takes it.
 * Refuses a level the agent does not offer, or any level for an agent with
 * no thinking setting, saying so with `data`. An agent never started here
 * has offered nothing yet, so it takes the level as given.
 */
export function pickEffort(
	offered: Setting[] | undefined,
	agent: string,
	effort: string,
	data: Record<string, unknown> = {},
): string {
	if (offered === undefined) {
		return effort;
	}
	const setting = offered.find((each) => each.category === THOUGHT_LEVEL);
	if (setting === undefined) {
		fail("usage", `${agent} offers no thinking level: leave --effort off`, {
			...data,
			agent,
			effort,
		});
	}
	const wanted = effort.toLowerCase();
	const picked = setting.options.find(
		(each) =>
			each.value.toLowerCase() === wanted || each.name.toLowerCase() === wanted,
	);
	if (picked === undefined) {
		fail(
			"usage",
			`${agent} has no thinking level '${effort}': use one of ${setting.options.map((each) => each.value).join(", ")}`,
			{ ...data, agent, effort },
		);
	}
	return picked.value;
}
