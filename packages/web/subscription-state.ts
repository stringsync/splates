import type { AutomationRow, Trigger } from "@splates/server/hooks";

/** How a subscription stands: running, paused by the person or by splates, or ended for good. */
export type SubscriptionState = "active" | "paused" | "finished";

/** Which subscriptions the list shows. */
export type SubscriptionFilter = "all" | SubscriptionState;

export const FILTERS: SubscriptionFilter[] = [
	"all",
	"active",
	"paused",
	"finished",
];

/** What sets a subscription off: a signal, a task event, or a schedule (every so often or a cron line). */
export type TriggerKind = "signal" | "event" | "schedule";

/** Which triggers the list shows. */
export type TriggerFilter = "any" | TriggerKind;

export const TRIGGERS: { filter: TriggerFilter; label: string }[] = [
	{ filter: "any", label: "Any trigger" },
	{ filter: "signal", label: "Signal" },
	{ filter: "event", label: "Task event" },
	{ filter: "schedule", label: "Schedule" },
];

/** What kind of thing sets `trigger` off. */
export function kindOf(trigger: Trigger): TriggerKind {
	return "signal" in trigger
		? "signal"
		: "event" in trigger
			? "event"
			: "schedule";
}

/** The person's own subscriptions, whatever sets them off, in the order they were made; not the checked-in `on` commands. */
export function subscriptionsOf(
	rows: readonly AutomationRow[],
): AutomationRow[] {
	return rows.filter((each) => each.source === undefined);
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

/** How many subscriptions each trigger filter shows. */
export function triggerCountsOf(
	rows: readonly AutomationRow[],
): Record<TriggerFilter, number> {
	const of = (kind: TriggerKind) =>
		rows.filter((each) => kindOf(each.trigger) === kind).length;
	return {
		any: rows.length,
		signal: of("signal"),
		event: of("event"),
		schedule: of("schedule"),
	};
}
