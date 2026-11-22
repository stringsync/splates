import { describe, expect, it } from "bun:test";
import { Position } from "core/geometry";
import { Annotation } from "./annotation";
import { PlanMarkup } from "./plan-markup";
import { act, fireEvent, render } from "./testing-library";

describe("plan markup", () => {
	it("returns to selection after one shape and leaves the marks editable", () => {
		const annotation = new Annotation(new File([], "plan.png"), {
			width: 800,
			height: 600,
			close() {},
		} as ImageBitmap);
		const view = render(
			<PlanMarkup annotation={annotation} onLive={() => {}} />,
		);
		const box = view.getByRole("button", { name: "Box" });
		fireEvent.click(box);
		expect(box.getAttribute("aria-pressed")).toBe("true");
		act(() => {
			annotation.press(new Position(30, 30));
			annotation.move(new Position(200, 160));
		});
		fireEvent.pointerUp(view.getByLabelText("plan capture markup"));
		expect(annotation.marks).toHaveLength(1);
		expect(annotation.marks[0]?.kind).toBe("box");
		expect(box.getAttribute("aria-pressed")).toBe("false");
		act(() => annotation.write(0, "More room here."));
		expect(annotation.marks[0]?.note).toBe("More room here.");
		fireEvent.click(view.getByRole("button", { name: "Undo" }));
		expect(annotation.marks).toHaveLength(0);
	});
});
