import { describe, expect, it } from "bun:test";
import { Position } from "webappwiz/geometry";
import { Annotation } from "./annotation";

/** An annotation of a 1100 by 550 image, whose marks are 5px thick. */
function annotation(): Annotation {
	const image = { width: 1100, height: 550, close() {} };
	return new Annotation(
		new File([], "shot.png", { type: "image/png" }),
		image as unknown as ImageBitmap,
	);
}

const at = (across: number, down: number) => new Position(across, down);

/** Drags from `from` to `to` on `on`, with the tool it has. */
function drag(on: Annotation, from: Position, to: Position): void {
	on.press(from);
	on.move(to);
	on.release();
}

describe("Annotation", () => {
	it("draws a box with the drag, and opens its note", () => {
		const marks = annotation();
		drag(marks, at(100, 100), at(300, 200));
		expect(marks.marks).toEqual([
			{ kind: "box", from: at(100, 100), to: at(300, 200), note: "" },
		]);
		expect(marks.selected).toBe(0);
		expect(marks.draft).toBeNull();
	});

	it("draws an arrow with the arrow tool", () => {
		const marks = annotation();
		marks.use("arrow");
		drag(marks, at(100, 100), at(300, 200));
		expect(marks.marks[0]?.kind).toBe("arrow");
	});

	it("pins a click, or a drag too short to be one", () => {
		const marks = annotation();
		drag(marks, at(400, 300), at(405, 302));
		expect(marks.marks).toEqual([
			{ kind: "pin", from: at(400, 300), to: at(400, 300), note: "" },
		]);
	});

	it("shows the mark being dragged out before it joins the marks", () => {
		const marks = annotation();
		marks.press(at(100, 100));
		marks.move(at(200, 150));
		expect(marks.marks).toEqual([]);
		expect(marks.draft?.to).toEqual(at(200, 150));
	});

	it("opens a mark's note from its number rather than drawing", () => {
		const marks = annotation();
		drag(marks, at(100, 100), at(300, 200));
		drag(marks, at(500, 300), at(700, 400));
		marks.press(marks.anchor(0).translate(2, -2));
		marks.release();
		expect(marks.marks).toHaveLength(2);
		expect(marks.selected).toBe(0);
	});

	it("picks a mark anywhere along its line", () => {
		const marks = annotation();
		drag(marks, at(100, 100), at(500, 300));
		marks.use("arrow");
		drag(marks, at(600, 100), at(900, 400));
		marks.select(null);
		expect(marks.markAt(at(300, 301))).toBe(0);
		expect(marks.markAt(at(750, 252))).toBe(1);
		expect(marks.markAt(at(300, 200))).toBeNull();
	});

	it("picks a mark a little way off its line, by the slop given", () => {
		const marks = annotation();
		drag(marks, at(100, 100), at(500, 300));
		expect(marks.markAt(at(300, 315))).toBeNull();
		expect(marks.markAt(at(300, 315), 12)).toBe(0);
	});

	it("opens a mark's note from its line rather than drawing", () => {
		const marks = annotation();
		drag(marks, at(100, 100), at(500, 300));
		marks.select(null);
		marks.press(at(500, 200));
		marks.release();
		expect(marks.marks).toHaveLength(1);
		expect(marks.selected).toBe(0);
	});

	it("sits a box's number outside it, on the side with more room", () => {
		const marks = annotation();
		drag(marks, at(100, 100), at(300, 200));
		drag(marks, at(700, 100), at(1000, 200));
		expect(marks.anchor(0).x).toBeGreaterThan(300);
		expect(marks.side(0)).toBe("right");
		expect(marks.anchor(1).x).toBeLessThan(700);
		expect(marks.side(1)).toBe("left");
	});

	it("sits an arrow's number behind its tail, its note away from it", () => {
		const marks = annotation();
		marks.use("arrow");
		drag(marks, at(400, 300), at(700, 300));
		expect(marks.anchor(0).x).toBeLessThan(400);
		expect(marks.anchor(0).y).toBe(300);
		expect(marks.side(0)).toBe("left");
	});

	it("drags a note without moving its mark or its number", () => {
		const marks = annotation();
		marks.use("arrow");
		drag(marks, at(400, 300), at(700, 300));
		marks.select(null);
		const number = marks.anchor(0);
		expect(marks.label(0)).toEqual(number);
		// The card is beside the number, not on it.
		marks.hold(0, number.translate(-100, 0));
		marks.move(number.translate(-150, -50));
		marks.release();
		expect(marks.label(0)).toEqual(number.translate(-50, -50));
		expect(marks.anchor(0)).toEqual(number);
		expect(marks.marks[0]).toMatchObject({
			from: at(400, 300),
			to: at(700, 300),
		});
		expect(marks.selected).toBeNull();
	});

	it("opens a note from a number dragged, rather than moving it", () => {
		const marks = annotation();
		drag(marks, at(100, 100), at(300, 200));
		marks.select(null);
		const number = marks.anchor(0);
		drag(marks, number, at(600, 450));
		expect(marks.anchor(0)).toEqual(number);
		expect(marks.label(0)).toEqual(number);
		expect(marks.marks).toHaveLength(1);
		expect(marks.selected).toBe(0);
	});

	it("opens a note held but not moved", () => {
		const marks = annotation();
		drag(marks, at(100, 100), at(300, 200));
		marks.select(null);
		marks.hold(0, at(50, 50));
		marks.move(at(51, 51));
		marks.release();
		expect(marks.marks[0]?.label).toBeUndefined();
		expect(marks.selected).toBe(0);
	});

	it("keeps each number and note on the image", () => {
		const marks = annotation();
		drag(marks, at(0, 0), at(1100, 200));
		marks.select(null);
		const edge = marks.badge + marks.stroke;
		expect(marks.anchor(0).x).toBe(edge);
		marks.hold(0, marks.label(0));
		marks.move(at(-50, 900));
		marks.release();
		expect(marks.label(0)).toEqual(at(edge, 550 - edge));
	});

	it("sits a pin's number above its spot", () => {
		const marks = annotation();
		drag(marks, at(400, 300), at(400, 300));
		expect(marks.anchor(0).x).toBe(400);
		expect(marks.anchor(0).y).toBeLessThan(300);
	});

	it("renumbers the marks after one is removed", () => {
		const marks = annotation();
		drag(marks, at(100, 100), at(300, 200));
		marks.write(0, "first");
		drag(marks, at(500, 300), at(700, 400));
		marks.write(1, "second");
		marks.remove(0);
		expect(marks.marks.map((each) => each.note)).toEqual(["second"]);
		expect(marks.selected).toBeNull();
	});

	it("undoes the last mark", () => {
		const marks = annotation();
		drag(marks, at(100, 100), at(300, 200));
		drag(marks, at(500, 300), at(700, 400));
		marks.undo();
		expect(marks.marks).toHaveLength(1);
	});

	it("sends the image itself when nothing is drawn on it", async () => {
		const marks = annotation();
		expect(await marks.flatten()).toBe(marks.original);
	});

	it("has no notes for images it never marked up", () => {
		expect(Annotation.notesFor([new File([], "a.png")])).toBe("");
	});

	it("thickens its marks on a bigger image", () => {
		const big = new Annotation(new File([], "big.png"), {
			width: 4400,
			height: 2000,
			close() {},
		} as unknown as ImageBitmap);
		expect(big.stroke).toBe(20);
		expect(annotation().stroke).toBe(5);
	});
});
