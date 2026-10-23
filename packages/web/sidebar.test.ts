import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import {
	DEFAULT_WIDTH,
	MAX_WIDTH,
	MIN_WIDTH,
	Sidebar,
	SidebarHandle,
} from "./sidebar";
import { cleanup, fireEvent, render } from "./testing";

afterEach(cleanup);

describe("Sidebar", () => {
	let sidebar: Sidebar;
	beforeEach(() => {
		localStorage.clear();
		sidebar = new Sidebar(localStorage);
	});

	it("starts at the default, and keeps a width once asked to", () => {
		expect(sidebar.width).toBe(DEFAULT_WIDTH);

		sidebar.set(300);
		expect(new Sidebar(localStorage).width).toBe(DEFAULT_WIDTH);
		sidebar.keep();
		expect(new Sidebar(localStorage).width).toBe(300);
	});

	it("stays within its range, however far it is dragged or what was kept", () => {
		sidebar.set(10);
		expect(sidebar.width).toBe(MIN_WIDTH);
		sidebar.set(5000);
		expect(sidebar.width).toBe(MAX_WIDTH);

		localStorage.setItem("splates.sidebarWidth", "9999");
		expect(new Sidebar(localStorage).width).toBe(MAX_WIDTH);
		localStorage.setItem("splates.sidebarWidth", "wide");
		expect(new Sidebar(localStorage).width).toBe(DEFAULT_WIDTH);
	});

	it("goes back to the default on reset, keeping nothing", () => {
		sidebar.set(320);
		sidebar.keep();
		sidebar.reset();
		expect(sidebar.width).toBe(DEFAULT_WIDTH);
		expect(localStorage.getItem("splates.sidebarWidth")).toBeNull();
	});

	it("hides and shows again, keeping a hidden one hidden", () => {
		expect(sidebar.shown).toBe(true);

		sidebar.toggle();
		expect(sidebar.shown).toBe(false);
		expect(new Sidebar(localStorage).shown).toBe(false);
		sidebar.toggle();
		expect(new Sidebar(localStorage).shown).toBe(true);
		expect(new Sidebar().shown).toBe(true);
	});
	it("folds its pages and unfolds them, keeping folded ones folded", () => {
		expect(sidebar.pagesShown).toBe(true);

		sidebar.togglePages();
		expect(sidebar.pagesShown).toBe(false);
		expect(new Sidebar(localStorage).pagesShown).toBe(false);
		sidebar.togglePages();
		expect(new Sidebar(localStorage).pagesShown).toBe(true);
		expect(new Sidebar().pagesShown).toBe(true);
	});
	// scry-ignore simple-test-setup: only the drag case mounts a handle and counts pointer-driven changes; Sidebar is shared in beforeEach
	it("updates the DOM during a drag and commits the clamped width only on release", () => {
		let changes = 0;
		sidebar.events.on("changed", () => changes++);
		const view = render(
			createElement(
				"div",
				{ "data-sidebar-layout": "" },
				createElement(SidebarHandle, { sidebar }),
			),
		);
		const handle = view.getByRole("separator");
		handle.setPointerCapture = () => {};
		fireEvent.pointerDown(handle, {
			button: 0,
			clientX: sidebar.width,
			pointerId: 1,
		});
		fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
		expect(
			handle.parentElement?.style.getPropertyValue("--sidebar-width"),
		).toBe("300px");
		expect({ width: sidebar.width, changes }).toEqual({
			width: DEFAULT_WIDTH,
			changes: 0,
		});
		fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
		fireEvent.pointerUp(handle, { pointerId: 1 });
		expect({ width: sidebar.width, changes }).toEqual({
			width: MAX_WIDTH,
			changes: 1,
		});
		expect(new Sidebar(localStorage).width).toBe(MAX_WIDTH);
	});
});
