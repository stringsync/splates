import type { WorkerAlert, WorkerStanding } from "./budget";
import type { BudgetReason } from "./scheduler";

/**
 * What a push says of `alert`, like `Workers: 90% of today's $5.00`, keyed
 * by its limit and window, so a later tier replaces an earlier one.
 */
export function alertNotice(alert: WorkerAlert): {
	title: string;
	body: string;
	key: string;
} {
	const { standing, tier } = alert;
	const limit =
		standing.limit === "hour"
			? `the ${dollars(standing.dollars)}/h rate cap`
			: `${standing.window === "today" ? "today's" : "this month's"} ${dollars(standing.dollars)}`;
	const spent =
		standing.limit === "hour"
			? `Made workers cost ${dollars(standing.spent)}/h.`
			: `Made workers cost about ${dollars(standing.spent)} ${standing.window}.`;
	return {
		title:
			tier === 100
				? `Workers: ${limit} reached`
				: `Workers: ${tier}% of ${limit}`,
		body:
			tier === 100
				? `${spent} ${standing.limit === "hour" ? "No more are made" : "Made workers stop"} until it is raised: \`splates budget raise\`.`
				: spent,
		key: `worker-budget ${standing.limit} ${standing.since}`,
	};
}

/** What a queue says when `standing`'s limit holds it, like `daily limit $5.00 reached`. */
export function reached(standing: WorkerStanding): BudgetReason {
	return standing.limit === "hour"
		? `rate cap ${dollars(standing.dollars)}/h reached`
		: `${standing.limit === "day" ? "daily" : "monthly"} limit ${dollars(standing.dollars)} reached`;
}

/** `amount` as dollars, to the cent, or to a tenth of one when it has one. */
export function dollars(amount: number): string {
	const cents = amount * 100;
	return Math.abs(cents - Math.round(cents)) < 1e-6
		? `$${amount.toFixed(2)}`
		: `$${amount.toFixed(3)}`;
}
