import type { AutomationRow } from "@splates/server/hooks";

/** How a subscription stands: running on its signal, paused by the person or by splates, or ended for good. */
export type SubscriptionState = "active" | "paused" | "finished";

/** Which subscriptions the list shows. */
export type SubscriptionFilter = "all" | SubscriptionState;

export const FILTERS: SubscriptionFilter[] = [
	"all",
	"active",
	"paused",
	"finished",
];

/** The automations the person set on a signal: the subscriptions, in the order they were made. */
export function subscriptionsOf(
	rows: readonly AutomationRow[],
): AutomationRow[] {
	return rows.filter(
		(each) => "signal" in each.trigger && each.source === undefined,
	);
}

/** How subscription `row` stands. */
export function stateOf(row: AutomationRow): SubscriptionState {
	return row.finishedAt !== undefined
		? "finished"
		: row.paused === true
			? "paused"
			: "active";
}

/** The subscriptions `filter` shows. */
export function shown(
	rows: readonly AutomationRow[],
	filter: SubscriptionFilter,
): AutomationRow[] {
	return filter === "all"
		? [...rows]
		: rows.filter((each) => stateOf(each) === filter);
}

/** How many subscriptions each filter shows. */
export function countsOf(
	rows: readonly AutomationRow[],
): Record<SubscriptionFilter, number> {
	return {
		all: rows.length,
		active: shown(rows, "active").length,
		paused: shown(rows, "paused").length,
		finished: shown(rows, "finished").length,
	};
}
