import { duration } from "./stats-advice";
import type { Row } from "./stats-report";

/** A figure there is not enough data for. */
export const NONE = "\u2013";

/** A column of model task stats. */
interface Column {
	head: string;
	cell: (row: Row) => string;
}

/** Keep the essentials narrow enough to compare without scrolling. */
export const BY_MODEL: Column[] = [
	{ head: "Tasks", cell: (row) => String(row.ended) },
	{ head: "Duration", cell: (row) => figure(row.durationPerTask, duration) },
	{ head: "Working time", cell: (row) => figure(row.workedPerTask, duration) },
	{
		head: "Cost / task",
		cell: (row) => figure(row.costPerTask, (cost) => `$${cost.toFixed(2)}`),
	},
];

function figure(
	value: number | null,
	shown: (value: number) => string,
): string {
	return value === null ? NONE : shown(value);
}
