import { describe, expect, it } from "bun:test";
import type { JSX } from "react";
import { fireEvent, render, waitFor } from "./testing-library";
import { ZoomableImage } from "./zoom";

describe("ZoomableImage", () => {
	it("shows an actionable error when an image fails to load", () => {
		const page = render(<ZoomableImage src="/missing.png" alt="missing" />);
		fireEvent.error(page.getByRole("img", { name: "missing" }));
		expect(page.getByRole("alert").textContent).toContain("new tab");
	});

	it("opens a small vector image filling the viewer", async () => {
		const page = opened(<ZoomableImage src="/d.svg" alt="diagram" vector />);
		expect(await drawnWidth(page)).toBe("1500px");
	});

	it("opens a small raster image at its own size", async () => {
		const page = opened(<ZoomableImage src="/s.png" alt="shot" />);
		expect(await drawnWidth(page)).toBe("300px");
	});
});

/** Opens `image` in a 1500 by 800 viewer, the image's own size 300 by 120. */
function opened(image: JSX.Element) {
	const page = render(image);
	const box = page.container.querySelector(".splates-image-viewer");
	for (const [key, value] of [
		["clientWidth", 1500],
		["clientHeight", 800],
	] as const) {
		Object.defineProperty(box, key, { value });
	}
	const img = page.getByRole("img");
	Object.defineProperty(img, "naturalWidth", { value: 300 });
	Object.defineProperty(img, "naturalHeight", { value: 120 });
	fireEvent.load(img);
	return page;
}

/** The width PhotoSwipe draws the opened image at. */
async function drawnWidth(page: ReturnType<typeof render>): Promise<string> {
	let width = "";
	await waitFor(() => {
		const drawn = page.container.querySelector<HTMLImageElement>(".pswp__img");
		width = drawn?.style.width ?? "";
		expect(width).not.toBe("");
	});
	return width;
}
