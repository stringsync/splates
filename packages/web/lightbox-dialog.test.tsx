import { afterEach, describe, expect, it } from "bun:test";
import { Composing } from "./composing";
import { Lightbox } from "./lightbox-dialog";
import { fireEvent, render, waitFor, within } from "./testing-library";

describe("Unified Lightbox", () => {
	const originalMatchMedia = window.matchMedia;

	afterEach(() => {
		window.matchMedia = originalMatchMedia;
	});

	function mockPhoneViewport(): void {
		window.matchMedia = (query) =>
			query.startsWith("(max-width: 639")
				? ({
						matches: true,
						addEventListener: () => {},
						removeEventListener: () => {},
					} as unknown as MediaQueryList)
				: originalMatchMedia.call(window, query);
	}
	it("places Fit width and Fit all in the top bar for tall images with no floating overlay on the image", async () => {
		let closed = 0;
		const page = render(
			<Lightbox
				items={[{ url: "/tall.png", alt: "tall.png", video: false }]}
				index={0}
				onIndex={() => {}}
				onClose={() => {
					closed += 1;
				}}
			/>,
		);
		const dialog = page.baseElement.querySelector<HTMLElement>(
			'[data-slot="lightbox"]',
		);
		if (!dialog) {
			throw new Error("lightbox did not open");
		}
		const viewer = dialog.querySelector<HTMLElement>(".splates-image-viewer");
		if (!viewer) {
			throw new Error("image viewer missing");
		}
		Object.defineProperty(viewer, "clientWidth", { value: 1280 });
		Object.defineProperty(viewer, "clientHeight", { value: 720 });
		const img = within(dialog).getByRole("img", { name: "tall.png" });
		Object.defineProperty(img, "naturalWidth", { value: 1200 });
		Object.defineProperty(img, "naturalHeight", { value: 2400 });
		fireEvent.load(img);

		const header = dialog.querySelector("header");
		if (!header) {
			throw new Error("lightbox header missing");
		}
		await waitFor(() => {
			expect(
				within(header).getByRole("group", { name: "Image fit" }),
			).toBeTruthy();
		});
		// Nothing floats over the image stage itself.
		expect(
			within(viewer).queryByRole("button", { name: "Fit width" }),
		).toBeNull();
		expect(
			within(viewer).queryByRole("button", { name: "Fit all" }),
		).toBeNull();

		// Clicking Fit width in the header switches the active state.
		const fitGroup = within(header).getByRole("group", { name: "Image fit" });
		const fitWidth = within(fitGroup).getByRole("button", {
			name: "Fit width",
		});
		const fitAll = within(fitGroup).getByRole("button", { name: "Fit all" });
		expect(fitAll.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(fitWidth);
		await waitFor(() => {
			expect(fitWidth.getAttribute("aria-pressed")).toBe("true");
		});
		expect(closed).toBe(0);
	});

	it("renders HTML previews in the same header shell and closes on iframe Escape message", () => {
		let closed = 0;
		const page = render(
			<Lightbox
				items={[
					{
						url: "/api/conversations/c1/artifacts/sim.html/1",
						alt: "sim.html",
						video: false,
						html: true,
						name: "sim.html",
					},
				]}
				index={0}
				onIndex={() => {}}
				onClose={() => {
					closed += 1;
				}}
			/>,
		);
		const dialog = page.baseElement.querySelector<HTMLElement>(
			'[data-slot="lightbox"]',
		);
		if (!dialog) {
			throw new Error("lightbox did not open");
		}
		const header = dialog.querySelector("header");
		if (!header) {
			throw new Error("lightbox header missing");
		}
		expect(within(header).getByText("sim.html")).toBeTruthy();
		expect(within(header).getByText("Sandboxed")).toBeTruthy();
		expect(within(header).getByRole("button", { name: "close" })).toBeTruthy();

		const frame = within(dialog).getByTitle("sim.html") as HTMLIFrameElement;
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { splates: "escape" },
				source: frame.contentWindow,
			}),
		);
		expect(closed).toBe(1);
	});

	it("isolates a 48px Close button in the phone header and moves Fit, Mark up, and Pop out to the bottom dock", async () => {
		mockPhoneViewport();
		const stepped: number[] = [];
		const page = render(
			<Composing.Provider value={{ addAttachment: async () => {} }}>
				<Lightbox
					items={[
						{ url: "/tall.png", alt: "tall.png", video: false },
						{ url: "/other.png", alt: "other.png", video: false },
					]}
					index={0}
					onIndex={(next) => {
						stepped.push(next);
					}}
					onClose={() => {}}
				/>
			</Composing.Provider>,
		);
		const dialog = page.baseElement.querySelector<HTMLElement>(
			'[data-slot="lightbox"]',
		);
		if (!dialog) {
			throw new Error("lightbox did not open");
		}
		const viewer = dialog.querySelector<HTMLElement>(".splates-image-viewer");
		if (!viewer) {
			throw new Error("image viewer missing");
		}
		Object.defineProperty(viewer, "clientWidth", { value: 390 });
		Object.defineProperty(viewer, "clientHeight", { value: 600 });
		const img = within(dialog).getByRole("img", { name: "tall.png" });
		Object.defineProperty(img, "naturalWidth", { value: 780 });
		Object.defineProperty(img, "naturalHeight", { value: 2400 });
		fireEvent.load(img);

		const header = dialog.querySelector("header");
		const dock = dialog.querySelector<HTMLElement>(
			'[data-slot="lightbox-dock"]',
		);
		if (!header || !dock) {
			throw new Error("header or mobile dock missing");
		}

		// Close is isolated in the header at 48px (`size-12`), with no sibling buttons.
		const closeBtn = within(header).getByRole("button", { name: "close" });
		expect(closeBtn.className).toContain("size-12");
		expect(within(header).getAllByRole("button")).toHaveLength(1);
		expect(within(header).queryByRole("link")).toBeNull();

		// Fit, Mark up, and Pop out live in the bottom thumb dock at 44px (`h-11` / `size-11`).
		const fitBtn = await waitFor(() =>
			within(dock).getByRole("button", { name: "Fit all" }),
		);
		expect(fitBtn.className).toContain("h-11");
		const markUpBtn = within(dock).getByRole("button", { name: "Mark up" });
		expect(markUpBtn.className).toContain("h-11");
		const popOut = within(dock).getByRole("link", {
			name: "open in a new tab",
		});
		expect(popOut.className).toContain("size-11");

		// Tapping Fit all switches to Fit width.
		fireEvent.click(fitBtn);
		await waitFor(() => {
			expect(
				within(dock).getByRole("button", { name: "Fit width" }),
			).toBeTruthy();
		});

		// Gallery arrows use 48px (`size-12`) hit areas and step items.
		const prevBtn = within(dialog).getByRole("button", { name: "previous" });
		const nextBtn = within(dialog).getByRole("button", { name: "next" });
		expect(prevBtn.className).toContain("size-12");
		expect(nextBtn.className).toContain("size-12");
		fireEvent.click(nextBtn);
		expect(stepped).toEqual([1]);
	});

	it("places Sandboxed and Open in new tab in the bottom dock for HTML previews on phones", () => {
		mockPhoneViewport();
		const page = render(
			<Lightbox
				items={[
					{
						url: "/api/conversations/c1/artifacts/sim.html/1",
						alt: "sim.html",
						video: false,
						html: true,
						name: "sim.html",
					},
				]}
				index={0}
				onIndex={() => {}}
				onClose={() => {}}
			/>,
		);
		const dialog = page.baseElement.querySelector<HTMLElement>(
			'[data-slot="lightbox"]',
		);
		if (!dialog) {
			throw new Error("lightbox did not open");
		}
		const header = dialog.querySelector("header");
		const dock = dialog.querySelector<HTMLElement>(
			'[data-slot="lightbox-dock"]',
		);
		if (!header || !dock) {
			throw new Error("header or mobile dock missing");
		}
		expect(within(header).getAllByRole("button")).toHaveLength(1);
		expect(within(header).queryByText("Sandboxed")).toBeNull();
		expect(within(dock).getByText("Sandboxed")).toBeTruthy();
		expect(
			within(dock).getByRole("link", { name: "open in a new tab" }).textContent,
		).toContain("Open in new tab");
	});
});
