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

	it("opens a tall image at Fit all in a landscape viewport, with Fit width available", async () => {
		const page = opened(<ZoomableImage src="/tall.png" alt="tall" />, {
			viewer: { width: 1500, height: 800 },
			image: { width: 1200, height: 2400 },
		});
		expect(await drawnWidth(page)).toBe("400px");
		const fitAll = page.getByRole("button", { name: "Fit all" });
		const fitWidth = page.getByRole("button", { name: "Fit width" });
		expect(fitAll.getAttribute("aria-pressed")).toBe("true");
		expect(fitWidth.getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(fitWidth);
		await waitFor(() => {
			expect(fitWidth.getAttribute("aria-pressed")).toBe("true");
		});
		expect(await drawnWidth(page)).toBe("1200px");
	});

	it("opens a tall image at Fit width in a portrait viewport, with Fit all available", async () => {
		const page = opened(<ZoomableImage src="/tall.png" alt="tall" />, {
			viewer: { width: 390, height: 760 },
			image: { width: 780, height: 3000 },
		});
		expect(await drawnWidth(page)).toBe("390px");
		const fitWidth = page.getByRole("button", { name: "Fit width" });
		const fitAll = page.getByRole("button", { name: "Fit all" });
		expect(fitWidth.getAttribute("aria-pressed")).toBe("true");
		expect(fitAll.getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(fitAll);
		await waitFor(() => {
			expect(fitAll.getAttribute("aria-pressed")).toBe("true");
		});
		expect(await drawnWidth(page)).toBe("198px");
	});

	it("omits the fit toggle when an image already fits across a portrait viewport", async () => {
		const page = opened(<ZoomableImage src="/wide.png" alt="wide" />, {
			viewer: { width: 390, height: 760 },
			image: { width: 1200, height: 800 },
		});
		expect(await drawnWidth(page)).toBe("390px");
		expect(page.queryByRole("button", { name: "Fit width" })).toBeNull();
		expect(page.queryByRole("button", { name: "Fit all" })).toBeNull();
	});
});

/** Opens `image` in a viewer of `viewer` size, with natural `image` dimensions. */
function opened(
	image: JSX.Element,
	{
		viewer = { width: 1500, height: 800 },
		image: natural = { width: 300, height: 120 },
	}: {
		viewer?: { width: number; height: number };
		image?: { width: number; height: number };
	} = {},
) {
	const page = render(image);
	const box = page.container.querySelector(".splates-image-viewer");
	for (const [key, value] of [
		["clientWidth", viewer.width],
		["clientHeight", viewer.height],
	] as const) {
		Object.defineProperty(box, key, { value });
	}
	const img = page.getByRole("img");
	Object.defineProperty(img, "naturalWidth", { value: natural.width });
	Object.defineProperty(img, "naturalHeight", { value: natural.height });
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
