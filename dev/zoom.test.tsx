import "../../../setup";
import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { MAX, UNZOOMED, within, ZoomableImage, zoomAt } from "./zoom";

describe("ZoomableImage", () => {
	const tap = (image: Element) => {
		const at = { pointerId: 1, clientX: 10, clientY: 10 };
		fireEvent.pointerDown(image, at);
		fireEvent.pointerUp(image, at);
	};

	it("keeps still the point it zooms at", () => {
		const view = zoomAt(UNZOOMED, { x: 100, y: 40 }, 2);
		expect(view).toEqual({ scale: 2, x: -100, y: -40 });
		// What lay 100, 40 into the image is drawn at 100, 40 still.
		expect(view.x + 100 * view.scale).toBe(100);
		expect(view.y + 40 * view.scale).toBe(40);
	});

	it("zooms no further than MAX, and never out past the image's size", () => {
		expect(zoomAt(UNZOOMED, { x: 0, y: 0 }, 100).scale).toBe(MAX);
		expect(zoomAt(UNZOOMED, { x: 0, y: 0 }, 0.2).scale).toBe(1);
	});

	it("keeps a zoomed image over its own box", () => {
		const view = { scale: 2, x: 30, y: -500 };
		expect(within(view, 200, 100)).toEqual({ scale: 2, x: 0, y: -100 });
	});

	it("zooms in on a scroll up and a pinch out alike", () => {
		const page = render(<ZoomableImage src="/shot.png" alt="shot" />);
		const image = page.getByRole("img", { name: "shot" });
		// Fingers moving up a trackpad, with natural scrolling.
		fireEvent.wheel(image, { deltaY: 200 });
		expect(image.style.transform).toContain("scale(1.4");
		fireEvent.wheel(image, { deltaY: -200 });
		expect(image.style.transform).toBe("");
		// Fingers spreading apart. happy-dom's WheelEvent drops ctrlKey.
		const pinch = new WheelEvent("wheel", { deltaY: -40, cancelable: true });
		Object.defineProperty(pinch, "ctrlKey", { value: true });
		fireEvent(image, pinch);
		expect(image.style.transform).toContain("scale(1.4");
	});

	it("zooms in on a double tap, and back out on the next", () => {
		const page = render(<ZoomableImage src="/shot.png" alt="shot" />);
		const image = page.getByRole("img", { name: "shot" });
		tap(image);
		expect(image.style.transform).toBe("");
		tap(image);
		expect(image.style.transform).toContain("scale(2.5)");
		tap(image);
		tap(image);
		expect(image.style.transform).toBe("");
	});
});
