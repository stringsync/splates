import type { Details } from "../show";

/** A row and the rows of the parts handed out from its task, nested alike. */
export interface Nested<Row> {
	row: Row;
	parts: Nested<Row>[];
}

/** The task `task` is a part of, by its base `task/<parent>`, or null. */
export function parentOf(tasks: Details[], task: string | null): string | null {
	const base = tasks.find((each) => each.task === task)?.base ?? "";
	return base.startsWith("task/") ? base.slice("task/".length) : null;
}

/**
 * `rows` with each part's rows under the first row of the task it was handed
 * out from, in their order; a part whose parent has no row stays at the top,
 * as does any row a loop of bases would otherwise hide.
 */
export function nest<Row>(
	rows: Row[],
	tasks: Details[],
	taskOf: (row: Row) => string | null,
): Nested<Row>[] {
	const nested = rows.map((row) => ({ row, parts: [] as Nested<Row>[] }));
	const hostOf = (at: number): Nested<Row> | undefined => {
		const parent = parentOf(tasks, taskOf(rows[at] as Row));
		return parent === null
			? undefined
			: nested.find((each) => taskOf(each.row) === parent);
	};
	const top: Nested<Row>[] = [];
	nested.forEach((each, at) => {
		const host = hostOf(at);
		if (host === undefined || host === each) {
			top.push(each);
		} else {
			host.parts.push(each);
		}
	});
	const reached = new Set<Nested<Row>>();
	const walk = (each: Nested<Row>): void => {
		if (!reached.has(each)) {
			reached.add(each);
			each.parts.forEach(walk);
		}
	};
	top.forEach(walk);
	nested.forEach((each, at) => {
		if (!reached.has(each)) {
			// In a loop of bases: taken out of it to the top, its parts with it.
			const host = hostOf(at) as Nested<Row>;
			host.parts.splice(host.parts.indexOf(each), 1);
			top.push(each);
			walk(each);
		}
	});
	return top;
}
