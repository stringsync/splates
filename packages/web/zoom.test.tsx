import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "./testing-library";
import { ZoomableImage } from "./zoom";

describe("ZoomableImage", () => {
	it("shows an actionable error when an image fails to load", () => {
		const page = render(<ZoomableImage src="/missing.png" alt="missing" />);
		fireEvent.error(page.getByRole("img", { name: "missing" }));
		expect(page.getByRole("alert").textContent).toContain("new tab");
	});
});
