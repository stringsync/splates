import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Position } from "core/geometry";
import { createRef } from "react";
import { Annotate } from "./annotate-dialog";
import { NoteBar } from "./annotate-phone";
import { Annotation } from "./annotation";
import { fireEvent, render, within } from "./testing-library";

describe("Annotating on a phone", () => {
	const media = window.matchMedia;

	beforeEach(() => {
		// Narrow, every other query answering as it did.
		window.matchMedia = (query) =>
			query.startsWith("(max-width: 639")
				? ({
						matches: true,
						addEventListener: () => {},
						removeEventListener: () => {},
					} as unknown as MediaQueryList)
				: media.call(window, query);
	});

	afterEach(() => {
		window.matchMedia = media;
	});

	it("shows a single Done button in the phone header without a duplicate close button", () => {
		const marks = drawn(1);
		marks.select(null);
		const board = opened(marks);
		const header = board.querySelector("header");
		if (!header) {
			throw new Error("header missing");
		}
		expect(within(header).getByRole("button", { name: "Done" })).toBeTruthy();
		expect(within(header).queryByRole("button", { name: "close" })).toBeNull();
	});

	it("docks the tools at its foot and lists the marks as chips, not a sheet", () => {
		const marks = drawn(1);
		marks.select(null);
		const board = opened(marks);

		expect(within(board).getByRole("group", { name: "tool" })).toBeTruthy();
		expect(within(board).getByRole("button", { name: /^1/ })).toBeTruthy();
		expect(within(board).queryByRole("button", { name: /^Marks/ })).toBeNull();
	});

	it("hides the tools while a note is written and brings them back once it is put down", () => {
		const board = opened(drawn(1));
		expect(within(board).queryByRole("group", { name: "tool" })).toBeNull();

		fireEvent.click(
			within(board).getByRole("button", { name: "Done with this note" }),
		);

		expect(within(board).getByRole("group", { name: "tool" })).toBeTruthy();
	});

	it("shows no note bar until a mark is drawn", () => {
		const page = render(
			<NoteBar annotation={annotation()} field={createRef()} />,
		);

		expect(page.queryByRole("region", { name: "marks" })).toBeNull();
	});

	it("writes the note of the mark whose chip is tapped", () => {
		const marks = drawn(2);
		marks.select(null);
		const page = render(<NoteBar annotation={marks} field={createRef()} />);

		fireEvent.click(page.getByRole("button", { name: /^1/ }));
		fireEvent.change(page.getByLabelText("note on mark 1"), {
			target: { value: "too tight" },
		});

		expect(marks.selected).toBe(0);
		expect(marks.marks[0]?.note).toBe("too tight");
		expect(marks.marks[1]?.note).toBe("");
		expect(page.getByRole("button", { name: /too tight/ })).toBeTruthy();
	});

	it("puts the note down on its check button or Enter", () => {
		const marks = drawn(1);
		const page = render(<NoteBar annotation={marks} field={createRef()} />);

		fireEvent.click(page.getByRole("button", { name: "Done with this note" }));
		expect(marks.selected).toBeNull();
		expect(page.queryByLabelText("note on mark 1")).toBeNull();

		fireEvent.click(page.getByRole("button", { name: /^1/ }));
		fireEvent.keyDown(page.getByLabelText("note on mark 1"), { key: "Enter" });
		expect(marks.selected).toBeNull();
	});

	it("removes the picked mark", () => {
		const marks = drawn(2);
		const page = render(<NoteBar annotation={marks} field={createRef()} />);

		fireEvent.click(page.getByRole("button", { name: "remove mark 2" }));

		expect(marks.marks).toHaveLength(1);
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

/** An annotation with `count` boxes drawn on it, the last one picked. */
function drawn(count: number): Annotation {
	const marks = annotation();
	for (let at = 0; at < count; at++) {
		marks.press(new Position(100, 100 + at * 150));
		marks.move(new Position(300, 200 + at * 150));
		marks.release();
	}
	return marks;
}

/** The annotator opened on `marks`. */
function opened(marks: Annotation): HTMLElement {
	const page = render(<Annotate annotation={marks} onDone={() => {}} />);
	const board = page.baseElement.querySelector<HTMLElement>(
		'[data-slot="annotate"]',
	);
	if (!board) {
		throw new Error("the annotator did not open");
	}
	return board;
}
