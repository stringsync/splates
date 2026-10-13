import "../../../setup";
import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
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
		const canvas = board.querySelector("canvas");
		const stage = canvas?.parentElement?.parentElement;
		if (!stage) {
			throw new Error("no space around the image");
		}
		fireEvent.click(stage);

		expect(done()).toBe(2);
	});

	it("stays open on a click on the image or its tools", () => {
		const { done, board } = opened();

		const canvas = board.querySelector("canvas");
		if (!canvas) {
			throw new Error("no image");
		}
		fireEvent.click(canvas);
		const fieldset = board.querySelector("fieldset");
		if (!fieldset) {
			throw new Error("no tools");
		}
		fireEvent.click(fieldset);

		expect(done()).toBe(0);
	});
});
