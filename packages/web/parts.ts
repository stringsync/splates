/** A row and the rows of the parts handed out from it, nested alike. */
export interface Nested<Row> {
	row: Row;
	parts: Nested<Row>[];
}

/** Whether a branch is `task/<task>`, what a part of `task` is cut from. */
export function isPartOf(base: string | null, task: string | null): boolean {
	return task !== null && base === `task/${task}`;
}

/**
 * `rows` with each part's rows under the first row `isHost` says it was
 * handed out from, in their order; a part with no such row stays at the top,
 * as does any row a loop of hosts would otherwise hide.
 */
export function nest<Row>(
	rows: Row[],
	isHost: (host: Row, part: Row) => boolean,
): Nested<Row>[] {
	const nested = rows.map((row) => ({ row, parts: [] as Nested<Row>[] }));
	const hostOf = (at: number): Nested<Row> | undefined =>
		nested.find(
			(each, index) => index !== at && isHost(each.row, rows[at] as Row),
		);
	const top: Nested<Row>[] = [];
	nested.forEach((each, at) => {
		const host = hostOf(at);
		if (host === undefined) {
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
			// In a loop of hosts: taken out of it to the top, its parts with it.
			const host = hostOf(at) as Nested<Row>;
			host.parts.splice(host.parts.indexOf(each), 1);
			top.push(each);
			walk(each);
		}
	});
	return top;
}
