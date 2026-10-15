import "../../../setup";
import { describe, expect, it } from "bun:test";
import { fireEvent, render, within } from "@testing-library/react";
import { Annotate } from "./annotate";
import { Annotation } from "./annotation";

/** An annotation of a 1100 by 550 image. */
function annotation(): Annotation {
	const image = { width: 1100, height: 550, close() {} };
	return new Annotation(
		new File([], "shot.png", { type: "image/png" }),
		image as unknown as ImageBitmap,
	);
}

/** Opens the annotator on a fresh image, counting each time it is done. */
function opened(): { done: () => number; board: HTMLElement } {
	let done = 0;
	const page = render(
		<Annotate annotation={annotation()} onDone={() => done++} />,
	);
	const board = page.baseElement.querySelector<HTMLElement>(
		'[data-slot="annotate"]',
	);
	if (!board) {
		throw new Error("the annotator did not open");
	}
	return { done: () => done, board };
}

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

	it("stays open on a click in the frame around the image or on its tools", () => {
		const { done, board } = opened();

		fireEvent.click(within(board).getByLabelText(/^shot\.png, with/));
		fireEvent.click(within(board).getByRole("group", { name: "tool" }));

		expect(done()).toBe(0);
	});
});
