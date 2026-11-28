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
			view.getByRole("tab", { name: /Board/ }).getAttribute("aria-selected"),
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
		expect(localStorage.getItem("splates.sidebarWidth")).toBe("256");

		fireEvent.doubleClick(edge);
		expect(edge.getAttribute("aria-valuenow")).toBe("224");
	});

	it("hides and shows the sidebar from the button beside the slot mark", async () => {
		const view = await testing.open();

		const tabs = view.getByRole("tab", { name: /Board/ });
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Hide sidebar/ })),
		);
		expect(tabs.closest("[role=tablist]")?.classList.contains("hidden")).toBe(
			true,
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Show sidebar/ })),
		);
		expect(tabs.closest("[role=tablist]")?.classList.contains("hidden")).toBe(
			false,
		);
	});

	it("collapses secondary workspace pages behind More and keeps that choice across visits", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.open();

		expect(view.queryByRole("tab", { name: /Stats/ })).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^More \(7\)/ })),
		);
		expect(view.getByRole("tab", { name: /Stats/ }).hidden).toBe(false);
		expect(localStorage.getItem("splates.sidebarMorePages")).toBe("1");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Less/ })),
		);
		expect(view.queryByRole("tab", { name: /Stats/ })).toBeNull();
		expect(localStorage.getItem("splates.sidebarMorePages")).toBeNull();
	});

	it("places Conversations above Workspace in the desktop sidebar inside an inset shell", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.open();

		const nav = view.getByRole("navigation", { name: "conversations" });
		const workspace = view.getByRole("tab", { name: /Boards/ });
		expect(
			nav.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		const layout = view.container.querySelector("[data-sidebar-layout]");
		expect(layout?.className).toContain("bg-sidebar");
		expect(view.container.querySelector(".page-header-glow")).toBeNull();
		expect(view.container.querySelector(".page-header-sheen")).toBeNull();
	});

	it("uses canonical 14px menu items across Workspace, More, Archived, and Settings with no sidebar status pill", async () => {
		testing.talk = { agents: [], conversations: [] };
		testing.machine = {
			cpu: 0.1,
			memory: 0.2,
			load: 1,
			cores: 8,
			kind: "Mac",
			temperature: null,
			splates: null,
			queue: [],
		};
		const view = await testing.open();

		const boards = view.getByRole("tab", { name: /Boards/ });
		const more = view.getByRole("button", { name: /^More \(7\)/ });
		const archived = view.getByRole("button", { name: "Archived" });
		const settings = view.getByRole("button", { name: "Settings" });
		expect(
			view.container.querySelector('[data-slot="sidebar-status-pill"]'),
		).toBeNull();
		expect(
			[boards, more, archived, settings].map((item) => ({
				textSm: item.className.includes("text-sm"),
				h9: item.className.includes("h-9"),
				px25: item.className.includes("px-2.5"),
			})),
		).toEqual([
			{ textSm: true, h9: true, px25: true },
			{ textSm: true, h9: true, px25: true },
			{ textSm: true, h9: true, px25: true },
			{ textSm: true, h9: true, px25: true },
		]);
		expect(
			archived.compareDocumentPosition(settings) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("opens Settings from the desktop sidebar footer below Archived with its shortcut hint while keeping the page menu entry", async () => {
		testing.talk = { agents: [], conversations: [] };
		const view = await testing.open();

		expect(await menuItem(view, "Settings")).toBeTruthy();

		const archived = view.getByRole("button", { name: "Archived" });
		const settings = view.getByRole("button", { name: "Settings" });
		expect(
			archived.compareDocumentPosition(settings) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(settings.querySelector("span[aria-hidden]")?.textContent).toContain(
			",",
		);

		await act(async () => fireEvent.click(settings));
		expect(view.getByRole("region", { name: "Settings" })).toBeTruthy();
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
			within(view.getByRole("region", { name: "Backlog" })).getAllByText(
				/later/,
			),
		).not.toHaveLength(0);
		expect(view.queryByText("alpha")).toBeNull();
		await act(async () => {
			location.hash = "#tasks";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		await waitFor(() => expect(view.getByText("alpha")).toBeTruthy());
		expect(view.queryByText("later")).toBeNull();
		expect(location.hash).toBe("#tasks");
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Board/ })),
		);
		expect(location.hash).toBe("#boards");
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
				fireEvent.click(within(drawer).getByRole("button", { name: /Stats/ })),
			);
			expect(location.hash).toBe("#stats");
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
		// vet-ignore no-monkeypatching: happy-dom lacks the Fullscreen API; restored by returned cleanup
		Object.defineProperties(document, {
			fullscreenEnabled: { configurable: true, get: () => true },
			fullscreenElement: { configurable: true, get: () => element },
			exitFullscreen: { configurable: true, value: () => flip(null) },
		});
		// vet-ignore no-monkeypatching: happy-dom lacks Element.requestFullscreen; restored by returned cleanup
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
