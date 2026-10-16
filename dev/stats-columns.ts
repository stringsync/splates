import { decimal, duration, percent } from "./stats-advice";
import type { Row } from "./stats-report";

/** A figure there is not enough data for. */
export const NONE = "\u2013";

/** A column of a breakdown, headed by what its figure counts. */
export interface Column {
	head: string;
	cell: (row: Row) => string;
}

const ENDED: Column = { head: "Tasks ended", cell: (row) => String(row.ended) };
const QUESTIONS: Column = {
	head: "Questions per task",
	cell: (row) => figure(row.questionsPerTask, decimal),
};
const REVIEWS: Column = {
	head: "Reviews per task",
	cell: (row) => figure(row.reviewsPerTask, decimal),
};
const OVERTURNED: Column = {
	head: "Picks overturned",
	cell: (row) => figure(row.overturnedShare, percent),
};
const REMOVED: Column = {
	head: "Tasks removed",
	cell: (row) => figure(row.removedShare, percent),
};

const COST: Column = {
	head: "Cost per task",
	cell: (row) => figure(row.costPerTask, (cost) => `$${cost.toFixed(2)}`),
};
const WORKED: Column = {
	head: "Agent working time",
	cell: (row) => figure(row.workedPerTask, duration),
};
const LINES: Column = {
	head: "Lines per task",
	cell: (row) => figure(row.linesPerTask, (lines) => String(Math.round(lines))),
};

/** Only what each table is read for: where questions come from, which model to name, how phone work goes, nothing for a project. */
export const BY_SYSTEM = [ENDED, QUESTIONS];
export const BY_MODEL = [
	ENDED,
	QUESTIONS,
	REVIEWS,
	OVERTURNED,
	REMOVED,
	COST,
	WORKED,
	LINES,
];
export const BY_DEVICE = [ENDED, QUESTIONS, REVIEWS, REMOVED];
export const BY_PROJECT = [ENDED, REMOVED, COST, LINES];

function figure(
	value: number | null,
	shown: (value: number) => string,
): string {
	return value === null ? NONE : shown(value);
}
