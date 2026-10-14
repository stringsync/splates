import { Position, Rect } from "webappwiz/geometry";

/**
 * One mark: a box between two corners, an arrow from its tail to its head, or
 * a pin at `from`. Its number is its place in the list, shown just off the
 * mark, with its note beside the number until the person drags it to `label`.
 */
export interface Mark {
	kind: "box" | "arrow" | "pin";
	from: Position;
	to: Position;
	note: string;
	label?: Position;
}

/** The square `reach` pixels each way from `point`. */
export function around(point: Position, reach: number): Rect {
	return new Rect(point.x - reach, point.y - reach, reach * 2, reach * 2);
}

export function distance(start: Position, end: Position): number {
	return Math.hypot(end.x - start.x, end.y - start.y);
}

/** The straight pieces a box's edges or an arrow's shaft are made of. */
export function outline(mark: Mark): [Position, Position][] {
	const { from, to } = mark;
	if (mark.kind !== "box") {
		return [[from, to]];
	}
	const corners = [
		from,
		new Position(to.x, from.y),
		to,
		new Position(from.x, to.y),
	];
	return corners.map((corner, each) => [
		corner,
		corners[(each + 1) % 4] as Position,
	]);
}

/** How far `point` is from the nearest spot on the line from `start` to `end`. */
export function toSegment(
	point: Position,
	start: Position,
	end: Position,
): number {
	const length = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
	if (length === 0) {
		return distance(point, start);
	}
	const along = Math.min(
		1,
		Math.max(
			0,
			((point.x - start.x) * (end.x - start.x) +
				(point.y - start.y) * (end.y - start.y)) /
				length,
		),
	);
	return distance(
		point,
		new Position(
			start.x + along * (end.x - start.x),
			start.y + along * (end.y - start.y),
		),
	);
}
