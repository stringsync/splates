import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "./testing-library";
import { clampScale, MAX, scrollAfterZoom, ZoomableImage } from "./zoom";

describe("ZoomableImage", () => {
	const tap = (box: Element) => {
		const at = { pointerId: 1, clientX: 10, clientY: 10 };
		fireEvent.pointerDown(box, at);
		fireEvent.pointerUp(box, at);
	};
	const open = () => {
		const page = render(<ZoomableImage src="/shot.png" alt="shot" />);
		const image = page.getByRole("img", { name: "shot" });
		return { image, box: image.parentElement as HTMLElement };
	};

	it("keeps still the point it zooms at", () => {
		// 100px into a viewport not yet scrolled, doubled: scroll by 100.
		expect(scrollAfterZoom(0, 100, 2)).toBe(100);
		expect(scrollAfterZoom(100, 100, 0.5)).toBe(0);
	});

	it("zooms no further than MAX, and never out past the image's size", () => {
		expect(clampScale(100)).toBe(MAX);
		expect(clampScale(0.2)).toBe(1);
	});

	it("zooms on ctrl and the wheel, as a trackpad pinch does, but not on a plain scroll", () => {
		const { image, box } = open();
		fireEvent.wheel(box, { deltaY: 200 });
		expect(box.dataset.scale).toBe("1");
		// Fingers spreading apart. happy-dom's WheelEvent drops ctrlKey.
		const pinch = new WheelEvent("wheel", { deltaY: -40, cancelable: true });
		Object.defineProperty(pinch, "ctrlKey", { value: true });
		fireEvent(box, pinch);
		expect(Number(box.dataset.scale)).toBeGreaterThan(1.4);
		expect(image.style.width).toContain("%");
	});

	it("zooms in on a double tap, and back out on the next", () => {
		const { image, box } = open();
		tap(box);
		expect(box.dataset.scale).toBe("1");
		tap(box);
		expect(box.dataset.scale).toBe("2.5");
		expect(image.style.width).toBe("250%");
		tap(box);
		tap(box);
		expect(box.dataset.scale).toBe("1");
		expect(image.style.width).toBe("");
	});
});
