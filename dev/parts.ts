/** A row and the rows of the parts handed out from its task, nested alike. */
export interface Nested<Row> {
	row: Row;
	parts: Nested<Row>[];
}

/** The task a base of `task/<parent>` was handed out from, or null. */
function parentOf(base: string | null): string | null {
	return base?.startsWith("task/") ? base.slice("task/".length) : null;
}

/**
 * `rows` with each part's rows under the first row of the task it was handed
 * out from, by its base `task/<parent>`, in their order; a part whose parent
 * has no row stays at the top, as does any row a loop of bases would
 * otherwise hide.
 */
export function nest<Row>(
	rows: Row[],
	taskOf: (row: Row) => string | null,
	baseOf: (row: Row) => string | null,
): Nested<Row>[] {
	const nested = rows.map((row) => ({ row, parts: [] as Nested<Row>[] }));
	const hostOf = (at: number): Nested<Row> | undefined => {
		const parent = parentOf(baseOf(rows[at] as Row));
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
