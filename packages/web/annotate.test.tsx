import { describe, expect, it } from "bun:test";
import { Position } from "core/geometry";
import { Annotate } from "./annotate-dialog";
import { Annotation } from "./annotation";
import { Note } from "./mark-notes";
import { fireEvent, render, within } from "./testing-library";

describe("Annotate", () => {
	it("is done on a click on the dimmed space around the image", () => {
		const { done, board } = opened();

		fireEvent.click(board);

		expect(done()).toBe(1);
	});

	it("is done on its close button", () => {
		const { done, board } = opened();

		fireEvent.click(within(board).getByRole("button", { name: "close" }));

		expect(done()).toBe(1);
	});

	it("is done on Enter unless a button or field has the focus", () => {
		const { done, board } = opened();

		fireEvent.keyDown(within(board).getByRole("button", { name: "close" }), {
			key: "Enter",
		});
		expect(done()).toBe(0);

		fireEvent.keyDown(board, { key: "Enter" });
		expect(done()).toBe(1);
	});

	it("stays open on a click in the frame around the image or on its tools", () => {
		const { done, board } = opened();

		fireEvent.click(within(board).getByLabelText(/^shot\.png, with/));
		fireEvent.click(within(board).getByRole("group", { name: "tool" }));

		expect(done()).toBe(0);
	});

	it("picks the box on B and the arrow on A", () => {
		const { board } = opened();
		const tool = (name: string) => within(board).getByRole("button", { name });

		expect(tool("Arrow").getAttribute("aria-pressed")).toBe("true");
		fireEvent.keyDown(board, { key: "b" });

		expect(tool("Box").getAttribute("aria-pressed")).toBe("true");
		expect(tool("Arrow").getAttribute("aria-pressed")).toBe("false");
	});

	it("undoes a mark just drawn on Ctrl+Z from its empty note", () => {
		const marks = annotation();
		marks.press(new Position(100, 100));
		marks.move(new Position(300, 200));
		marks.release();
		expect(marks.marks).toHaveLength(1);
		const page = render(
			<Note
				annotation={marks}
				at={0}
				grip={{}}
				bounds={{ current: document.body }}
			/>,
		);

		fireEvent.keyDown(page.getByLabelText("note on mark 1"), {
			key: "z",
			ctrlKey: true,
		});

		expect(marks.marks).toHaveLength(0);
	});
});

/** An annotation of a 1100 by 550 image. */
function annotation(): Annotation {
	const image = { width: 1100, height: 550, close() {} };
	return new Annotation(
		new File([], "shot.png", { type: "image/png" }),
		image as unknown as ImageBitmap,
	);
}

/** Opens the annotator on a fresh image, counting each time it is done. */
function opened(marks = annotation()): {
	done: () => number;
	board: HTMLElement;
} {
	let done = 0;
	const page = render(<Annotate annotation={marks} onDone={() => done++} />);
	const board = page.baseElement.querySelector<HTMLElement>(
		'[data-slot="annotate"]',
	);
	if (!board) {
		throw new Error("the annotator did not open");
	}
	return { done: () => done, board };
}
