import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	details,
	fireEvent,
	menuItem,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("has no status line, and opens on the todos", async () => {
		const view = await testing.open();

		expect(view.queryByLabelText("banner")).toBeNull();
		expect(
			view.getByRole("tab", { name: /Todos/ }).getAttribute("aria-selected"),
		).toBe("true");
		expect(view.queryByRole("tab", { name: /blocked/i })).toBeNull();
	});

	it("widens the sidebar by its edge, and keeps the width for the next visit", async () => {
		const view = await testing.open();
		const edge = view.getByRole("separator", { name: "Resize sidebar" });
		expect(edge.getAttribute("aria-valuenow")).toBe("224");

		fireEvent.keyDown(edge, { key: "ArrowRight" });
		fireEvent.keyDown(edge, { key: "ArrowRight" });
		expect(edge.getAttribute("aria-valuenow")).toBe("256");
		expect(localStorage.getItem("arbor.sidebarWidth")).toBe("256");

		fireEvent.doubleClick(edge);
		expect(edge.getAttribute("aria-valuenow")).toBe("224");
	});

	it("names the repo atop the sidebar, beside the button that hides it", async () => {
		const view = await testing.open();

		expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
			"webappwiz",
		);
		const tabs = view.getByRole("tab", { name: /Todos/ });
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Hide sidebar/ })),
		);
		expect(tabs.closest("[role=tablist]")?.classList.contains("hidden")).toBe(
			true,
		);
		expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
			"webappwiz",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Show sidebar/ })),
		);
		expect(tabs.closest("[role=tablist]")?.classList.contains("hidden")).toBe(
			false,
		);
	});

	it("says in the page menu who Cloudflare Access signed in, with Sign out, and nothing on this machine", async () => {
		const local = await testing.open();
		await act(async () =>
			fireEvent.click(local.getByRole("button", { name: "More" })),
		);
		await waitFor(() => local.getByRole("menuitem", { name: "Settings" }));
		expect(local.queryByTitle(/Signed in as/)).toBeNull();
		expect(local.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
		cleanup();

		testing.email = "me@example.com";
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More" })),
		);

		const line = await waitFor(() =>
			view.getByTitle("Signed in as me@example.com"),
		);
		expect(line.textContent).toBe("me@example.com");
		// Out of the header, where it pushed into the tabs below.
		expect(line.closest("header")).toBeNull();
		expect(view.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
	});

	it("shows the todos and the tasks on pages of their own, kept in the address", async () => {
		const view = await testing.open({
			tasks: [details({ task: "alpha" })],
			todos: [todo({ subject: "later" })],
		});

		expect(
			within(view.getByRole("region", { name: "Untriaged" })).getByText(
				/later/,
			),
		).toBeTruthy();
		expect(view.queryByText("alpha")).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Tasks/ })),
		);
		await waitFor(() => expect(view.getByText("alpha")).toBeTruthy());
		expect(view.queryByText("later")).toBeNull();
		expect(location.hash).toBe("#tasks");
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Todos/ })),
		);
		expect(location.hash).toBe("");
	});

	/** happy-dom answers media queries against this, 1024 wide to start. */
	const resize = (width: number) =>
		(
			window as unknown as {
				happyDOM: { setViewport(size: { width: number }): void };
			}
		).happyDOM.setViewport({ width });

	/** Which way the pages' tabs run, from the root that decides it. */
	const orientation = (view: Awaited<ReturnType<Testing["open"]>>) =>
		view
			.getByRole("tablist")
			.closest("[data-slot=tabs]")
			?.getAttribute("data-orientation");

	it("puts the pages in a drawer on a phone, and down the side of anything wider", async () => {
		try {
			resize(390);
			const phone = await testing.open();
			expect(phone.queryByRole("tablist")).toBeNull();
			await act(async () =>
				fireEvent.click(phone.getByRole("button", { name: "Open menu" })),
			);
			const drawer = await waitFor(() =>
				phone.getByRole("dialog", { name: "Pages" }),
			);
			await act(async () =>
				fireEvent.click(within(drawer).getByRole("button", { name: /Tasks/ })),
			);
			expect(location.hash).toBe("#tasks");
			cleanup();

			resize(1280);
			expect(orientation(await testing.open())).toBe("vertical");
		} finally {
			resize(1024);
		}
	});

	/** The Fullscreen API, which happy-dom leaves out, flipping as a browser does. */
	const fullscreenable = () => {
		let element: Element | null = null;
		const flip = (to: Element | null) => {
			element = to;
			document.dispatchEvent(new Event("fullscreenchange"));
			return Promise.resolve();
		};
		Object.defineProperties(document, {
			fullscreenEnabled: { configurable: true, get: () => true },
			fullscreenElement: { configurable: true, get: () => element },
			exitFullscreen: { configurable: true, value: () => flip(null) },
		});
		document.documentElement.requestFullscreen = () =>
			flip(document.documentElement);
		return () => {
			for (const name of [
				"fullscreenEnabled",
				"fullscreenElement",
				"exitFullscreen",
			]) {
				delete (document as unknown as Record<string, unknown>)[name];
			}
			delete (document.documentElement as { requestFullscreen?: unknown })
				.requestFullscreen;
		};
	};

	it("goes fullscreen and back by its button or ⌥⌘F", async () => {
		const restore = fullscreenable();
		testing.talk = { agents: [], conversations: [] };
		try {
			const view = await testing.open();

			await act(async () =>
				fireEvent.click(await menuItem(view, "Fullscreen")),
			);
			expect(document.fullscreenElement).toBe(document.documentElement);
			expect(await menuItem(view, "Exit fullscreen")).toBeTruthy();
			await act(async () =>
				fireEvent.keyDown(document, {
					code: "KeyF",
					altKey: true,
					metaKey: true,
				}),
			);
			expect(document.fullscreenElement).toBeNull();
			expect(await menuItem(view, "Fullscreen")).toBeTruthy();
		} finally {
			restore();
		}
	});

	it("leaves the button out where the browser keeps fullscreen to itself", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.open();

		await menuItem(view, "Power");
		expect(view.queryByRole("button", { name: "Fullscreen" })).toBeNull();
	});
});
